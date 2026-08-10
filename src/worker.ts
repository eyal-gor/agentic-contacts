import { Hono } from "hono";
import { contacts } from "./routes/contacts.js";
import { listsRoute } from "./routes/lists.js";
import { companiesRoute } from "./routes/companies.js";
import * as store from "./store.js";
import * as interactions from "./interactions.js";
import { requireApiKey, issueSession } from "./auth.js";
import { mcp } from "./mcp.js";
import * as keys from "./keys.js";
import { computeActivity, pushToKompany } from "./activity.js";
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

/**
 * Sign in with Google.
 *
 * One account, checked by address. The password still works — it is behind a
 * link on the sign-in card — but nobody has to remember it, and the one that
 * was in use had been forgotten and was unrecoverable, which is what a
 * password stored nowhere eventually is.
 *
 * Authorization-code flow. The id_token comes straight from Google's endpoint
 * over TLS and was never handled by the browser in between, so its signature
 * does not need re-checking here.
 */
function allowedEmail(env: Env): string {
  return (env.ALLOWED_EMAIL || "gneyal@gmail.com").toLowerCase();
}

app.get("/auth/google/start", (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.redirect("/?signin=unconfigured");
  }
  const state = crypto.randomUUID();
  // Lax, not Strict: the browser comes back from Google, which is a
  // cross-site navigation, and Strict withholds the cookie exactly then.
  c.header("Set-Cookie", `ac_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
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

app.get("/auth/google/callback", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookie = (c.req.header("Cookie") || "")
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith("ac_state="))
    ?.slice("ac_state=".length);
  const clear = "ac_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";

  if (!code || !state || !cookie || state !== cookie) {
    c.header("Set-Cookie", clear);
    return c.redirect("/?signin=state");
  }
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.redirect("/?signin=unconfigured");
  }

  let email = "";
  let verified = false;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${url.origin}/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    const body = (await res.json()) as { id_token?: string };
    if (!res.ok || !body.id_token) throw new Error(`token exchange returned ${res.status}`);
    const payload = JSON.parse(
      atob(body.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { email?: string; email_verified?: boolean | string };
    email = String(payload.email || "").toLowerCase();
    verified = payload.email_verified === true || payload.email_verified === "true";
  } catch (err) {
    console.log(`sign-in failed: ${err}`);
    c.header("Set-Cookie", clear);
    return c.redirect("/?signin=failed");
  }

  if (!verified || email !== allowedEmail(c.env)) {
    console.log(`refused sign-in from ${email || "(no address)"}`);
    c.header("Set-Cookie", clear);
    return c.redirect("/?signin=denied");
  }

  if (!c.env.APP_PASSWORD) {
    // Sessions are signed with it, so without one there is nothing to mint.
    c.header("Set-Cookie", clear);
    return c.redirect("/?signin=unconfigured");
  }
  const { token } = await issueSession(c.env);
  c.header("Set-Cookie", clear);
  // In the fragment, never the query: fragments are not sent to servers, so
  // the session cannot reach an access log or a Referer header on the way.
  return c.redirect(`/#session=${encodeURIComponent(token)}`);
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

// Networking activity as numbers — the same history `/events` draws, counted.
// ?days=N  window for the daily series (default 14, max 180)
app.get("/activity", requireApiKey, async (c) => {
  const days = Math.min(Math.max(Number(c.req.query("days")) || 14, 1), 180);
  return c.json(await computeActivity(c.env.DB, days));
});

// The single-page UI. Anything the API didn't claim falls through to the
// assets binding, which serves public/index.html.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

/**
 * Nightly: count the day's networking and report it to the Kompany canvas.
 *
 * Runs late enough in Israel time that "today" is actually over. The Worker
 * keeps its own numbers either way — this only mirrors them somewhere the
 * business is being steered from.
 */
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const activity = await computeActivity(env.DB, 14);
      const out = await pushToKompany(env, activity);
      console.log(`kompany push: ${out.pushed} ok, ${out.failed} failed`,
        JSON.stringify(activity.today));
    })());
  },
};
