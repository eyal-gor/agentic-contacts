import { Hono } from "hono";
import { contacts } from "./routes/contacts.js";
import { listsRoute } from "./routes/lists.js";
import { companiesRoute } from "./routes/companies.js";
import * as store from "./store.js";
import * as interactions from "./interactions.js";
import { requireApiKey, issueSession } from "./auth.js";
import { mcp } from "./mcp.js";
import * as keys from "./keys.js";
import type { Env } from "./db.js";

/**
 * Cloudflare Worker entry for Agentic Contacts.
 *
 * Replaces the Node/@hono/node-server entry: same Hono app, but bindings
 * (D1, assets, API_KEY) arrive per-request instead of from process.env, and
 * data lives in D1 instead of data/*.json.
 *
 * Deliberately dropped in the move:
 *  - datasync.ts — pushed the data dir to git via child_process. No processes
 *    on Workers, and D1 is the durable store now.
 *  - the request-header cap — that worked around localhost cookie bloat.
 */
const app = new Hono<{ Bindings: Env }>();

/**
 * Force HTTPS.
 *
 * The custom domain answers on port 80 as happily as on 443, and a browser
 * given a bare hostname tries http first — which is why the address bar said
 * "Not secure" while the certificate was perfectly valid. Redirect, then ask
 * the browser to stop trying http at all for a year. Not includeSubDomains:
 * this Worker has no business making promises for the rest of the domain.
 */
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const scheme = c.req.header("cf-visitor")?.includes('"http"') ? "http" : url.protocol.replace(":", "");
  if (scheme === "http") {
    url.protocol = "https:";
    return c.redirect(url.toString(), 301);
  }
  await next();
  c.res.headers.set("Strict-Transport-Security", "max-age=31536000");
});

// Unauthenticated: uptime checks shouldn't need the key.
app.get("/health", (c) => c.json({ status: "ok" }));

// Human sign-in: password → 30-day session token. Wrong guesses cost 600ms —
// enough to make brute force boring without a rate-limit table.
app.post("/auth/login", async (c) => {
  if (!c.env.APP_PASSWORD) return c.json({ error: "login not configured: set the APP_PASSWORD secret" }, 500);
  const { password } = (await c.req.json().catch(() => ({}))) as { password?: string };
  if (password !== c.env.APP_PASSWORD) {
    await new Promise((r) => setTimeout(r, 600));
    return c.json({ error: "wrong password" }, 401);
  }
  return c.json(await issueSession(c.env));
});

app.route("/contacts", contacts);
app.route("/mcp", mcp);
app.route("/companies", companiesRoute);
app.route("/lists", listsRoute);

// Key management, backing the Settings screen. Minting returns the plaintext
// exactly once; after that only the hash exists.
/**
 * Every credential that opens this API, not just the ones minted here.
 *
 * The shared key and the password live in Worker secrets, so they can't be
 * listed from the database — but a credential the screen doesn't mention is a
 * credential nobody remembers to retire. They're reported alongside, marked
 * as managed elsewhere.
 */
app.get("/keys", requireApiKey, async (c) => {
  const shared = c.env.API_KEY_STORE ? await c.env.API_KEY_STORE.get() : c.env.API_KEY;
  return c.json({
    keys: await keys.listKeys(c.env),
    credentials: {
      password: { configured: Boolean(c.env.APP_PASSWORD), sessionDays: 30 },
      shared: {
        configured: Boolean(shared),
        prefix: shared ? shared.slice(0, 12) + "…" : null,
        source: c.env.API_KEY_STORE ? "Cloudflare Secrets Store (account-level)" : "Worker secret",
      },
    },
  });
});
app.post("/keys", requireApiKey, async (c) => {
  const { name } = (await c.req.json().catch(() => ({}))) as { name?: string };
  if (!name?.trim()) return c.json({ error: "name is required" }, 400);
  const { row, key } = await keys.mintKey(c.env, name.trim());
  return c.json({ ...row, key }, 201);
});
app.delete("/keys/:id", requireApiKey, async (c) => {
  const ok = await keys.revokeKey(c.env, c.req.param("id"));
  return ok ? c.json({ revoked: true }) : c.json({ error: "no such active key" }, 404);
});

// Calendar feed: a flat, dated event stream across all contacts —
// interactions (when someone was contacted), the "added" event (contact
// created), and upcoming follow-ups. One call powers the calendar view.
app.get("/events", requireApiKey, async (c) => {
  const [all, inter] = await Promise.all([
    store.list(c.env.DB, { limit: 100_000 }),
    interactions.all(c.env.DB),
  ]);
  const nameOf = Object.fromEntries(all.map((ct) => [ct.id, ct.name]));
  const events: Array<{ date: string; kind: string; contactId: string; contact: string; text: string }> = [];
  for (const ct of all) {
    events.push({ date: ct.createdAt, kind: "added", contactId: ct.id, contact: ct.name, text: "Added as contact" });
    if (ct.followUpAt) {
      events.push({ date: ct.followUpAt, kind: "follow-up", contactId: ct.id, contact: ct.name, text: ct.followUpNote || "Follow up" });
    }
  }
  for (const i of inter) {
    events.push({ date: i.occurredAt, kind: i.channel, contactId: i.contactId, contact: nameOf[i.contactId] || "?", text: i.summary });
  }
  return c.json({ events, count: events.length });
});

// The single-page UI. Anything the API didn't claim falls through to the
// assets binding, which serves public/index.html.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
