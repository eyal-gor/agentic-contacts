import { Hono } from "hono";
import { contacts } from "./routes/contacts.js";
import { listsRoute } from "./routes/lists.js";
import { companiesRoute } from "./routes/companies.js";
import * as store from "./store.js";
import * as interactions from "./interactions.js";
import { requireApiKey } from "./auth.js";
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

app.route("/contacts", contacts);
app.route("/companies", companiesRoute);
app.route("/lists", listsRoute);

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
