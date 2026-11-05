import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "./db.js";

/**
 * Two ways in, one middleware:
 *
 *  - `Authorization: Bearer <API_KEY>` — agents, the CLI, and sibling
 *    services. The key lives in the account-level Secrets Store (single
 *    value, single place to rotate). Local dev can't reach the store, so
 *    .dev.vars still works as a fallback — in that direction only.
 *
 *  - `ac_session` cookie — the browser, minted by the Google sign-in flow
 *    below (same shape as the p_38 blog's admin auth: OAuth code flow,
 *    one allowed account, HMAC-signed expiry token). Sessions are signed
 *    with SESSION_SECRET, falling back to GOOGLE_CLIENT_SECRET; with
 *    neither set no session verifies (fail closed), and rotating the
 *    secret signs everyone out.
 *
 * A missing API key is a configuration error, not dev mode: this service
 * is on the public internet holding real contacts, so refuse to serve
 * rather than serve openly.
 */

const SESSION_COOKIE = "ac_session";
const STATE_COOKIE = "ac_oauth_state";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

async function expectedApiKey(env: Env): Promise<string | undefined> {
  // Local dev simulates the Secrets Store binding but holds no value, so
  // get() throws there — fall back to API_KEY from .dev.vars.
  if (env.API_KEY_STORE) {
    try {
      return await env.API_KEY_STORE.get();
    } catch {
      /* fall through */
    }
  }
  return env.API_KEY;
}

/**
 * Split-host mode (optional): the app on APP_ORIGIN, sign-in on AUTH_ORIGIN
 * (the host whose callback Google knows), and the session cookie shared
 * across both via COOKIE_DOMAIN. All three unset = one host, as before.
 */
export const appOrigin = (env: Env) => env.APP_ORIGIN?.replace(/\/+$/, "") || "";
const authOrigin = (env: Env) => env.AUTH_ORIGIN?.replace(/\/+$/, "") || "";
const cookieDomain = (env: Env) => (env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {});
/** Where the app lives: "/" on the app host, "/app" in single-host mode. */
export const appUrl = (env: Env, query = "") => (appOrigin(env) ? `${appOrigin(env)}/` : "/app") + query;

const sessionSecret = (env: Env) => env.SESSION_SECRET || env.GOOGLE_CLIENT_SECRET || null;
const allowedEmail = (env: Env) => (env.ALLOWED_EMAIL || "gneyal@gmail.com").toLowerCase();

async function hmacHex(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const b64url = {
  encode: (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)),
};

/** Token shape: `<expiresMs>.<b64url(email)>.<hmac(expires.email)>` */
async function createSessionToken(email: string, secret: string): Promise<string> {
  const payload = `${Date.now() + SESSION_MAX_AGE_SECONDS * 1000}.${b64url.encode(email)}`;
  return `${payload}.${await hmacHex(payload, secret)}`;
}

async function verifySessionToken(token: string | undefined, secret: string | null): Promise<{ email: string; expires: number } | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [expires, email64, sig] = parts;
  if (!safeEqual(sig, await hmacHex(`${expires}.${email64}`, secret))) return null;
  if (Number(expires) <= Date.now()) return null;
  try {
    return { email: b64url.decode(email64), expires: Number(expires) };
  } catch {
    return null;
  }
}

/** True when the request carries a valid Google session cookie. */
export async function hasSession(c: Context<{ Bindings: Env }>): Promise<boolean> {
  return !!(await verifySessionToken(getCookie(c, SESSION_COOKIE), sessionSecret(c.env)));
}

export const requireApiKey: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const expected = await expectedApiKey(c.env);
  if (!expected) {
    return c.json({ error: "server misconfigured: API_KEY is not set" }, 500);
  }
  if (c.req.header("Authorization") === `Bearer ${expected}`) return next();
  if (await verifySessionToken(getCookie(c, SESSION_COOKIE), sessionSecret(c.env))) return next();
  return c.json({ error: "unauthorized" }, 401);
};

/**
 * Google sign-in for the browser: /auth/login → Google consent →
 * /auth/callback → session cookie → back to the app. Only the single
 * allowed account gets a session; everyone else bounces to /?login=denied.
 */
export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.get("/login", (c) => {
  // Google only knows AUTH_ORIGIN's callback, so sign-in always runs there.
  const auth = authOrigin(c.env);
  if (auth && new URL(c.req.url).origin !== auth) return c.redirect(`${auth}/auth/login`);
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.redirect(appUrl(c.env, "?login=unconfigured"));
  }
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  setCookie(c, STATE_COOKIE, state, { path: "/", maxAge: 600, httpOnly: true, secure: true, sameSite: "Lax" });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/auth/google/callback`,
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Path matches the redirect URI registered on the shared OAuth client
// (…autobirds.com/auth/google/callback — same pattern as handset).
authRoutes.get("/google/callback", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/" });
  if (!code || !state || !expectedState || state !== expectedState) {
    return c.redirect(appUrl(c.env, "?login=failed"));
  }

  let email = "";
  let verified = false;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID || "",
        client_secret: c.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: `${url.origin}/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}`);
    const { id_token } = (await tokenRes.json()) as { id_token: string };
    // The ID token comes straight from Google's token endpoint over TLS, so
    // decoding the payload without a signature check is safe here.
    const payload = JSON.parse(b64url.decode(id_token.split(".")[1]));
    email = String(payload.email || "").toLowerCase();
    verified = payload.email_verified === true || payload.email_verified === "true";
  } catch (err) {
    console.error("[oauth] sign-in failed:", err);
    return c.redirect(appUrl(c.env, "?login=failed"));
  }

  if (!verified || email !== allowedEmail(c.env)) {
    console.warn(`[oauth] rejected sign-in from: ${email || "(no email)"}`);
    return c.redirect(appUrl(c.env, "?login=denied"));
  }

  const secret = sessionSecret(c.env);
  if (!secret) return c.redirect(appUrl(c.env, "?login=unconfigured"));
  setCookie(c, SESSION_COOKIE, await createSessionToken(email, secret), {
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    ...cookieDomain(c.env),
  });
  return c.redirect(appOrigin(c.env) ? `${appOrigin(c.env)}/` : "/");
});

authRoutes.get("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });                       // old host-only cookie
  if (c.env.COOKIE_DOMAIN) deleteCookie(c, SESSION_COOKIE, { path: "/", ...cookieDomain(c.env) });
  return c.redirect(authOrigin(c.env) ? `${authOrigin(c.env)}/` : "/");
});

// Reveal the shared API key to an authenticated user. Single-user app:
// anyone holding a valid session IS the owner, and the key is theirs —
// this is how the UI shows it without a trip to .env or the terminal.
authRoutes.get("/apikey", requireApiKey, async (c) => {
  return c.json({ apiKey: await expectedApiKey(c.env) });
});

// Who am I? Lets the UI tell a Google session from an API key without
// holding either. 401 when neither credential is present/valid.
authRoutes.get("/me", async (c) => {
  const session = await verifySessionToken(getCookie(c, SESSION_COOKIE), sessionSecret(c.env));
  if (session) return c.json({ email: session.email, method: "google", expires: session.expires });
  const expected = await expectedApiKey(c.env);
  if (expected && c.req.header("Authorization") === `Bearer ${expected}`) {
    return c.json({ method: "api-key" });
  }
  return c.json({ error: "unauthorized" }, 401);
});
