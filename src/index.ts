import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { contacts } from "./routes/contacts.js";
import { listsRoute } from "./routes/lists.js";
import * as store from "./store.js";
import * as interactions from "./interactions.js";
import { scheduleSync } from "./datasync.js";

const app = new Hono();
app.use("*", logger());

// After any mutating request, schedule a debounced push of the data repo.
app.use("*", async (c, next) => {
  await next();
  if (c.req.method !== "GET") scheduleSync();
});

app.get("/health", (c) => c.json({ status: "ok" }));

// Single-page pipeline UI, served same-origin so it can call the API
// without CORS. Read per-request so edits show on refresh in dev.
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
app.get("/", async (c) => c.html(await readFile(join(PUBLIC_DIR, "index.html"), "utf8")));

app.route("/contacts", contacts);
app.route("/lists", listsRoute);

// Calendar feed: a flat, dated event stream across all contacts —
// interactions (when someone was contacted), the "added" event (contact
// created), and upcoming follow-ups. One call powers the calendar view.
app.get("/events", async (c) => {
  const [all, inter] = await Promise.all([store.list({ limit: 100_000 }), interactions.all()]);
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

const port = Number(process.env.PORT ?? 8787);
// Raise the request-header cap well above Node's 16KB default. On localhost,
// cookies are shared across every app on any port, so a machine running many
// local dev servers can accumulate a cookie jar big enough to trip HTTP 431
// ("Request Header Fields Too Large") on an app that sets no cookies itself.
serve({ fetch: app.fetch, port, serverOptions: { maxHeaderSize: 256 * 1024 } }, (info) => {
  console.log(`agentic-contacts API listening on http://localhost:${info.port}`);
});

export { app };
