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
  if (c.req.header("Authorization") !== `Bearer ${expected}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
};
