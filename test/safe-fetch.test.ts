import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, safeDownload } from "../src/lib/safe-fetch.js";

test("private, loopback and metadata addresses are not public", () => {
  for (const addr of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
  ]) {
    assert.equal(isPublicAddress(addr), false, addr);
  }
});

test("ordinary internet addresses are public", () => {
  for (const addr of ["8.8.8.8", "157.240.1.35", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(addr), true, addr);
  }
});

test("non-https and internal URLs are refused before any request", async () => {
  await assert.rejects(safeDownload("http://example.com/a.jpg"), /Only https/);
  await assert.rejects(safeDownload("file:///etc/passwd"), /Only https/);
  await assert.rejects(safeDownload("https://127.0.0.1/a.jpg"), /public internet address/);
  await assert.rejects(safeDownload("https://[::1]/a.jpg"), /public internet address/);
  await assert.rejects(safeDownload("https://169.254.169.254/latest/meta-data/"), /public internet address/);
  await assert.rejects(safeDownload("https://user:pw@example.com/a.jpg"), /embedded credentials/);
});
