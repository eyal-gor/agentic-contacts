import { Hono } from "hono";
import { contacts } from "./routes/contacts.js";
import { listsRoute } from "./routes/lists.js";
import { companiesRoute } from "./routes/companies.js";
import * as store from "./store.js";
import * as interactions from "./interactions.js";
import { requireApiKey, authRoutes, hasSession, appOrigin } from "./auth.js";
import { rebuildAll } from "./keys.js";
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

// Unauthenticated: uptime checks shouldn't need the key.
app.get("/health", (c) => c.json({ status: "ok" }));

// Google sign-in for the browser (login/callback/logout/me). The routes
// themselves are unauthenticated — they're how a browser BECOMES authed.
app.route("/auth", authRoutes);

app.route("/contacts", contacts);
app.route("/companies", companiesRoute);
app.route("/lists", listsRoute);

// Rebuild the duplicate-match index from the tables. Safe to run any time;
// needed only if rows were written outside the API (e.g. raw D1 SQL).
app.post("/maintenance/reindex", requireApiKey, async (c) => c.json(await rebuildAll(c.env.DB)));

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

// "/" is the landing page for visitors and the app for the signed-in owner
// (so the Google callback's redirect to "/" lands in the app). /app always
// serves the app, for API-key sign-in and direct links.
const asset = (c: { env: Env; req: { url: string } }, path: string) =>
  c.env.ASSETS.fetch(new Request(new URL(path, c.req.url)));
const onAppHost = (c: { env: Env; req: { url: string } }) =>
  !!appOrigin(c.env) && new URL(c.req.url).origin === appOrigin(c.env);
app.get("/", async (c) => {
  if (onAppHost(c)) return asset(c, "/");
  // Split hosts: the main domain is always the landing page; only
  // "Sign in" (→ /app) moves you to the app host.
  if (appOrigin(c.env)) return asset(c, "/landing");
  return asset(c, (await hasSession(c)) ? "/" : "/landing");
});
app.get("/app", (c) => {
  if (appOrigin(c.env) && !onAppHost(c)) return c.redirect(`${appOrigin(c.env)}/${new URL(c.req.url).search}`);
  return asset(c, "/");
});

// Everything else the API didn't claim falls through to the assets binding.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
