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
 * The key lives in the account-level Secrets Store, bound here and by every
 * other service that calls this one, so there is a single value to rotate and
 * no copies to drift apart. Local dev can't reach the store, so .dev.vars
 * still works as a fallback — in that direction only, never the reverse.
 */
export const requireApiKey: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const expected = c.env.API_KEY_STORE ? await c.env.API_KEY_STORE.get() : c.env.API_KEY;
  if (!expected) {
    return c.json({ error: "server misconfigured: API_KEY is not set" }, 500);
  }
  if (c.req.header("Authorization") !== `Bearer ${expected}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
};
