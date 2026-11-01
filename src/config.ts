/**
 * Environment configuration loader.
 *
 * Reads required variables from process.env, validates them, and exposes a
 * single typed `config` object for the rest of the codebase.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

function optionalInt(name: string): number | undefined {
  const value = process.env[name];
  if (!value || value.trim() === "") return undefined;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer (cents), got "${value}"`);
  }
  return n;
}

export const config = {
  port: parseInt(optional("PORT", "3210"), 10),
  /**
   * Interface to bind. Defaults to loopback so the plain-HTTP port is only
   * reachable through the local TLS reverse proxy. Set 0.0.0.0 explicitly only
   * when something else terminates TLS in front of this host.
   */
  host: optional("HOST", "127.0.0.1"),
  logLevel: optional("LOG_LEVEL", "info") as
    | "debug"
    | "info"
    | "warn"
    | "error",
  meta: {
    accessToken: required("META_ACCESS_TOKEN"),
    apiVersion: optional("META_API_VERSION", "v26.0"),
  },
  /**
   * Bearer token a client must present in the Authorization header when
   * calling /mcp. In v0.1 (single-tenant), this is a single shared secret.
   * v0.2 will replace this with proper OAuth 2.1 + DCR.
   */
  authToken: (() => {
    const token = required("AUTH_TOKEN");
    if (token.length < 32) {
      throw new Error("AUTH_TOKEN must be at least 32 characters. Generate one with: openssl rand -hex 32");
    }
    return token;
  })(),
  publicUrl: optional("PUBLIC_URL", "http://localhost:3210"),
  /**
   * Hard budget caps in account-currency cents. Undefined = no cap. Enforced
   * server-side on create_campaign / create_adset / update_campaign /
   * update_adset — a conversation cannot override them.
   */
  limits: {
    maxDailyBudgetCents: optionalInt("MAX_DAILY_BUDGET_CENTS"),
    maxLifetimeBudgetCents: optionalInt("MAX_LIFETIME_BUDGET_CENTS"),
  },
  /**
   * Asset store + /upload page. Enabled when UPLOAD_DIR is set. Files are
   * served at PUBLIC_URL/assets/<random-id>.<ext>; the reverse proxy must
   * authenticate /upload (see docs/DEPLOYMENT.md).
   */
  upload: {
    dir: process.env.UPLOAD_DIR && process.env.UPLOAD_DIR.trim() !== "" ? process.env.UPLOAD_DIR.trim() : undefined,
    maxMb: optionalInt("UPLOAD_MAX_MB") ?? 100,
    pageLang: (optional("UPLOAD_PAGE_LANG", "en") === "de" ? "de" : "en") as "en" | "de",
  },
} as const;

export type Config = typeof config;
