import { Hono } from "hono";
import { ContactInput, ContactPatch, InteractionInput, MergeInput } from "../schema.js";
import * as dedupe from "../dedupe.js";
import { ensureIndexed } from "../keys.js";
import * as store from "../store.js";
import * as interactions from "../interactions.js";
import { requireApiKey } from "../auth.js";
import type { Env } from "../db.js";

export const contacts = new Hono<{ Bindings: Env }>();

contacts.use("*", requireApiKey);

contacts.get("/", async (c) => {
  const { q, tag, email, limit, offset } = c.req.query();
  if (email) await ensureIndexed(c.env.DB);
  const result = await store.list(c.env.DB, {
    q,
    tag,
    email,
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
  });
  const lastMap = await interactions.lastByContact(c.env.DB);
  let enriched = result.map((ct) => ({ ...ct, lastInteraction: lastMap[ct.id] ?? null }));

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
      .filter((ct) => ct.followUpAt && Date.parse(ct.followUpAt) <= cutoff)
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

// POST /contacts            → always creates; the response lists any
//                               possibleDuplicates so the caller can merge.
// POST /contacts?upsert=1   → updates the one contact sharing an email or
//                               LinkedIn instead (201 created / 200 updated,
//                               409 if the input matches two different people).
contacts.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ContactInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  const db = c.env.DB;

  if (c.req.query("upsert") === "1" || c.req.query("upsert") === "true" || body?.upsert === true) {
    const res = await dedupe.upsertContact(db, parsed.data);
    if (res.action === "ambiguous") {
      return c.json(
        {
          error: "ambiguous",
          message: "Input matches more than one contact. Merge them first (POST /contacts/merge).",
          candidates: res.candidates,
        },
        409,
      );
    }
    return c.json({ ...res.contact, upsert: { action: res.action, matchedOn: res.matchedOn } }, res.action === "created" ? 201 : 200);
  }

  const matches = await dedupe.contactMatches(db, parsed.data);
  const created = await store.create(db, parsed.data);
  return c.json(matches.length ? { ...created, possibleDuplicates: matches } : created, 201);
});

// --- Duplicates + merge (registered before /:id so they aren't ids) -------
contacts.get("/duplicates", async (c) => {
  const db = c.env.DB;
  const groups = await dedupe.groups(db, "contact");
  const withRecords = await Promise.all(
    groups.map(async (g) => ({ ...g, contacts: (await Promise.all(g.ids.map((id) => store.get(db, id)))).filter(Boolean) })),
  );
  return c.json({ groups: withRecords, count: withRecords.length });
});

// Check a would-be contact (same body as POST /contacts) or an existing one
// ({ "id": "..." }) against everyone else, without writing anything.
contacts.post("/duplicates", async (c) => {
  const body = await c.req.json().catch(() => null);
  const db = c.env.DB;
  let input: any = null;
  if (body?.id) input = await store.get(db, body.id);
  else {
    const parsed = ContactPatch.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    input = parsed.data;
  }
  if (!input) return c.json({ error: "not found" }, 404);
  const matches = await dedupe.contactMatches(db, input, body?.id);
  const out = await Promise.all(matches.map(async (m) => ({ ...m, contact: await store.get(db, m.id) })));
  return c.json({ matches: out, count: out.length });
});

contacts.post("/merge", async (c) => {
  const parsed = MergeInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  try {
    const { ids, keepId, dryRun } = parsed.data;
    return c.json(await dedupe.mergeContacts(c.env.DB, ids, keepId, dryRun));
  } catch (e) {
    if (e instanceof dedupe.MergeError) return c.json({ error: e.message }, e.status);
    throw e;
  }
});

contacts.get("/:id", async (c) => {
  const found = await store.get(c.env.DB, c.req.param("id"));
  if (!found) return c.json({ error: "not found" }, 404);
  const lastInteraction = (await interactions.listForContact(c.env.DB, found.id))[0] ?? null;
  return c.json({ ...found, lastInteraction });
});

// --- Interactions (conversation history) ---------------------------------
contacts.get("/:id/interactions", async (c) => {
  const found = await store.get(c.env.DB, c.req.param("id"));
  if (!found) return c.json({ error: "not found" }, 404);
  const items = await interactions.listForContact(c.env.DB, found.id);
  return c.json({ interactions: items, count: items.length });
});

contacts.post("/:id/interactions", async (c) => {
  const found = await store.get(c.env.DB, c.req.param("id"));
  if (!found) return c.json({ error: "not found" }, 404);
  const parsed = InteractionInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  return c.json(await interactions.add(c.env.DB, found.id, parsed.data), 201);
});

contacts.patch("/:id", async (c) => {
  const parsed = ContactPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  const updated = await store.update(c.env.DB, c.req.param("id"), parsed.data);
  return updated ? c.json(updated) : c.json({ error: "not found" }, 404);
});

contacts.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const ok = await store.remove(c.env.DB, id);
  if (!ok) return c.json({ error: "not found" }, 404);
  await interactions.removeForContact(c.env.DB, id);
  return c.body(null, 204);
});
