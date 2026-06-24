import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { contacts } from "./routes/contacts.js";
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

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`agentic-contacts API listening on http://localhost:${info.port}`);
});

export { app };
