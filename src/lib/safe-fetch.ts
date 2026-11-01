/**
 * Guarded download for media URLs supplied by a conversation.
 *
 * Upload tools accept "a public URL" and fetch it server-side. Without a
 * guard, anyone who can call a tool (or text that tricks the model into it)
 * could make this server request internal addresses: localhost services,
 * the cloud metadata endpoint, the private network. This module only allows
 * https URLs whose host resolves exclusively to public addresses, re-checks
 * every redirect hop, and caps the download size.
 *
 * Residual risk: DNS can in theory change between the check and the fetch
 * (rebinding). The check still stops the straightforward cases.
 */

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const MAX_REDIRECTS = 3;
export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

// Separate lists: Node's BlockList matches IPv4 lookups against IPv4-mapped
// IPv6 rules, so mixing families in one list would block every IPv4 address.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
// IPv4 special-purpose ranges
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(net, prefix, "ipv4");
}
// IPv6 special-purpose ranges
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedV6.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return !blockedV4.check(mapped[1], "ipv4");
    if (/^::ffff:/i.test(address)) return false; // other IPv4-mapped spellings: refuse
    return !blockedV6.check(address, "ipv6");
  }
  return false;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Only https:// URLs can be downloaded (got ${url.protocol})`);
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new Error(`Refused to download from ${url.hostname}: it does not resolve to a public internet address`);
  }
  return url;
}

/**
 * Download a public https URL with redirect re-checks and a size cap.
 * Returns the bytes and the server-reported content type.
 */
export async function safeDownload(
  raw: string,
  maxBytes = MAX_DOWNLOAD_BYTES
): Promise<{ bytes: ArrayBuffer; contentType: string | null }> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(120_000) });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new Error(`Redirect without a Location header from ${url.hostname}`);
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Failed to download asset (${res.status} ${res.statusText}) from ${url.hostname}`);
    }

    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      await res.body?.cancel();
      throw new Error(`File is larger than the ${Math.round(maxBytes / 1048576)} MB download limit`);
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error(`File is larger than the ${Math.round(maxBytes / 1048576)} MB download limit`);
        }
        chunks.push(value);
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes: out.buffer, contentType: res.headers.get("content-type") };
  }
  throw new Error(`Too many redirects (more than ${MAX_REDIRECTS})`);
}
