import { Hono } from "hono";
import { ContactInput, ContactPatch, InteractionInput } from "../schema.js";
import * as store from "../store.js";
import * as interactions from "../interactions.js";

export const contacts = new Hono();

// Optional single-key auth. If API_KEY is unset the API is open (dev mode).
const API_KEY = process.env.API_KEY;
contacts.use("*", async (c, next) => {
  if (!API_KEY) return next();
  if (c.req.header("Authorization") !== `Bearer ${API_KEY}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

contacts.get("/", async (c) => {
  const { q, tag, limit, offset } = c.req.query();
  const result = await store.list({
    q,
    tag,
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
  });
  const lastMap = await interactions.lastByContact();
  let enriched = result.map((c) => ({ ...c, lastInteraction: lastMap[c.id] ?? null }));

  // ?due=overdue|today|week|all → only contacts with a follow-up due by the
  // window, soonest-first. Anything without followUpAt is excluded.
  const due = c.req.query("due");
  if (due) {
    const now = Date.now();
    let cutoff: number;
    if (due === "overdue") cutoff = now;
    else if (due === "today") cutoff = new Date(new Date().setHours(23, 59, 59, 999)).getTime();
    else if (due === "week") cutoff = now + 7 * 86_400_000;
    else if (due === "all") cutoff = Infinity;
    else cutoff = Date.parse(due) || now; // explicit ISO cutoff
    enriched = enriched
      .filter((c) => c.followUpAt && Date.parse(c.followUpAt) <= cutoff)
      .sort((a, b) => Date.parse(a.followUpAt!) - Date.parse(b.followUpAt!));
  }

  // ?sort=recent → most-recently-contacted first (never-contacted last)
  // ?sort=stale  → needs-attention first: never-contacted, then oldest contact
  const sort = c.req.query("sort");
  if (sort === "recent" || sort === "stale") {
    const stale = sort === "stale";
    enriched.sort((a, b) => {
      const av = a.lastInteraction?.occurredAt ?? "";
      const bv = b.lastInteraction?.occurredAt ?? "";
      if (av === bv) return 0;
      if (!av) return stale ? -1 : 1; // never-contacted: top for stale, bottom for recent
      if (!bv) return stale ? 1 : -1;
      return (av < bv ? -1 : 1) * (stale ? 1 : -1); // oldest-first for stale, newest-first for recent
    });
  }

  return c.json({ contacts: enriched, count: enriched.length });
});

contacts.post("/", async (c) => {
  const parsed = ContactInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  return c.json(await store.create(parsed.data), 201);
});

contacts.get("/:id", async (c) => {
  const found = await store.get(c.req.param("id"));
  if (!found) return c.json({ error: "not found" }, 404);
  const lastInteraction = (await interactions.listForContact(found.id))[0] ?? null;
  return c.json({ ...found, lastInteraction });
});

// --- Interactions (conversation history) ---------------------------------
contacts.get("/:id/interactions", async (c) => {
  const found = await store.get(c.req.param("id"));
  if (!found) return c.json({ error: "not found" }, 404);
  const items = await interactions.listForContact(found.id);
  return c.json({ interactions: items, count: items.length });
});

contacts.post("/:id/interactions", async (c) => {
  const found = await store.get(c.req.param("id"));
  if (!found) return c.json({ error: "not found" }, 404);
  const parsed = InteractionInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  return c.json(await interactions.add(found.id, parsed.data), 201);
});

contacts.patch("/:id", async (c) => {
  const parsed = ContactPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  const updated = await store.update(c.req.param("id"), parsed.data);
  return updated ? c.json(updated) : c.json({ error: "not found" }, 404);
});

contacts.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const ok = await store.remove(id);
  if (!ok) return c.json({ error: "not found" }, 404);
  await interactions.removeForContact(id);
  return c.body(null, 204);
});
