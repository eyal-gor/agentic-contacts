import { Hono } from "hono";
import { CompanyInput, CompanyPatch } from "../schema.js";
import * as companies from "../companystore.js";
import * as contacts from "../store.js";
import { requireApiKey } from "../auth.js";
import type { Env } from "../db.js";

export const companiesRoute = new Hono<{ Bindings: Env }>();

companiesRoute.use("*", requireApiKey);

async function members(db: D1Database, companyId: string, companyName: string) {
  const all = await contacts.list(db, { limit: 100_000 });
  const normalized = companyName.trim().toLowerCase();
  return all.filter((ct: any) =>
    ct.companyId === companyId ||
    (ct.company || "").trim().toLowerCase() === normalized,
  );
}

companiesRoute.get("/", async (c) => {
  const { q, tag, status, limit, offset } = c.req.query();
  const result = await companies.list(c.env.DB, {
    q,
    tag,
    status,
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
  });
  return c.json({ companies: result, count: result.length });
});

companiesRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CompanyInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  const upsert = c.req.query("upsert") === "1" || body?.upsert === true;
  return c.json(upsert ? await companies.upsertByName(c.env.DB, parsed.data) : await companies.create(c.env.DB, parsed.data), upsert ? 200 : 201);
});

companiesRoute.get("/:id", async (c) => {
  const found = await companies.get(c.env.DB, c.req.param("id"));
  if (!found) return c.json({ error: "not found" }, 404);
  const people = await members(c.env.DB, found.id, found.name);
  return c.json({ ...found, contacts: people, contactCount: people.length });
});

companiesRoute.patch("/:id", async (c) => {
  const parsed = CompanyPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  const updated = await companies.update(c.env.DB, c.req.param("id"), parsed.data);
  return updated ? c.json(updated) : c.json({ error: "not found" }, 404);
});

companiesRoute.delete("/:id", async (c) => {
  const ok = await companies.remove(c.env.DB, c.req.param("id"));
  return ok ? c.body(null, 204) : c.json({ error: "not found" }, 404);
});
