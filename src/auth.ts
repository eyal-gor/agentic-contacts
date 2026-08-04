import type { MiddlewareHandler } from "hono";
import type { Env } from "./db.js";

/**
 * Single-key bearer auth — MANDATORY.
 *
 * The file-backed version made this optional ("if API_KEY is unset the API is
 * open") because it only ever listened on localhost. This service is now on the
 * public internet holding real contacts, so a missing key is a configuration
 * error, not dev mode: refuse to serve rather than serve openly.
 *
 * Set it with: wrangler secret put API_KEY
 */
export const requireApiKey: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const expected = c.env.API_KEY;
  if (!expected) {
    return c.json({ error: "server misconfigured: API_KEY is not set" }, 500);
  }
  const bearer = (c.req.header("Authorization") ?? "").replace(/^Bearer /, "");
  if (bearer === expected) return next();                     // machines: the API key
  if (await verifySession(c.env, bearer)) return next();      // humans: a login session
  return c.json({ error: "unauthorized" }, 401);
};

/**
 * Browser sessions — the human counterpart to the API key.
 *
 * A token is `st_<expiry-ms>.<hmac>`, signed with APP_PASSWORD itself: no
 * session table, and changing the password invalidates every session at once,
 * which is exactly what changing a password should do.
 */
const enc = new TextEncoder();
async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export async function issueSession(env: Env): Promise<{ token: string; expiresAt: string }> {
  const exp = Date.now() + SESSION_TTL_MS;
  return { token: `st_${exp}.${await hmac(env.APP_PASSWORD!, String(exp))}`, expiresAt: new Date(exp).toISOString() };
}

export async function verifySession(env: Env, token: string): Promise<boolean> {
  if (!env.APP_PASSWORD || !token.startsWith("st_")) return false;
  const [expStr, sig] = token.slice(3).split(".");
  if (!expStr || !sig || Date.now() > Number(expStr)) return false;
  return (await hmac(env.APP_PASSWORD, expStr)) === sig;
}
