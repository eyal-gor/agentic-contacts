import { Hono } from "hono";
import { ListInput } from "../schema.js";
import * as lists from "../liststore.js";
import * as store from "../store.js";

export const listsRoute = new Hono();

// Same optional single-key auth as the contacts route.
const API_KEY = process.env.API_KEY;
listsRoute.use("*", async (c, next) => {
  if (!API_KEY) return next();
  if (c.req.header("Authorization") !== `Bearer ${API_KEY}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

// A list's members are just the contacts carrying its membership tag — the
// contact store's tag filter does the work. High limit so a list is never
// silently truncated at the default page size.
async function members(id: string) {
  return store.list({ tag: lists.memberTag(id), limit: 100_000 });
}

listsRoute.get("/", async (c) => {
  const all = await lists.all();
  const withCounts = await Promise.all(
    all.map(async (l) => ({ ...l, memberCount: (await members(l.id)).length })),
  );
  return c.json({ lists: withCounts, count: withCounts.length });
});

listsRoute.post("/", async (c) => {
  const parsed = ListInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  return c.json(await lists.create(parsed.data.name), 201);
});

listsRoute.get("/:id", async (c) => {
  const l = await lists.get(c.req.param("id"));
  if (!l) return c.json({ error: "not found" }, 404);
  const mem = await members(l.id);
  return c.json({ ...l, members: mem, memberCount: mem.length });
});

listsRoute.patch("/:id", async (c) => {
  const parsed = ListInput.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !parsed.data.name) return c.json({ error: "invalid" }, 400);
  const updated = await lists.rename(c.req.param("id"), parsed.data.name);
  return updated ? c.json(updated) : c.json({ error: "not found" }, 404);
});

listsRoute.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const l = await lists.get(id);
  if (!l) return c.json({ error: "not found" }, 404);
  // Strip the membership tag off every member so no contact is left pointing
  // at a list that no longer exists.
  const tag = lists.memberTag(id);
  for (const m of await members(id)) {
    await store.update(m.id, { tags: (m.tags || []).filter((t) => t !== tag) });
  }
  await lists.remove(id);
  return c.body(null, 204);
});

// Batch-add contacts to a list: { ids: string[] }. Idempotent — already-in
// members are skipped, unknown ids ignored.
listsRoute.post("/:id/members", async (c) => {
  const id = c.req.param("id");
  const l = await lists.get(id);
  if (!l) return c.json({ error: "not found" }, 404);
  const body = (await c.req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? (body!.ids as string[]) : [];
  const tag = lists.memberTag(id);
  const added: string[] = [];
  for (const cid of ids) {
    const contact = await store.get(cid);
    if (!contact) continue;
    if (!(contact.tags || []).includes(tag)) {
      await store.update(cid, { tags: [...(contact.tags || []), tag] });
      added.push(cid);
    }
  }
  return c.json({ added, count: added.length });
});

listsRoute.delete("/:id/members/:contactId", async (c) => {
  const id = c.req.param("id");
  const cid = c.req.param("contactId");
  const contact = await store.get(cid);
  if (!contact) return c.json({ error: "not found" }, 404);
  const tag = lists.memberTag(id);
  await store.update(cid, { tags: (contact.tags || []).filter((t) => t !== tag) });
  return c.body(null, 204);
});
