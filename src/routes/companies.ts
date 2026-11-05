import { Hono } from "hono";
import { CompanyInput, CompanyPatch, MergeInput } from "../schema.js";
import * as dedupe from "../dedupe.js";
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
  const db = c.env.DB;
  const upsert = c.req.query("upsert") === "1" || c.req.query("upsert") === "true" || body?.upsert === true;
  if (upsert) {
    try {
      return c.json(await companies.upsertByName(db, parsed.data), 200);
    } catch (e) {
      if (e instanceof companies.AmbiguousMatch) {
        return c.json(
          {
            error: "ambiguous",
            message: "Name and domain match different companies. Merge them first (POST /companies/merge).",
            candidates: e.candidates,
          },
          409,
        );
      }
      throw e;
    }
  }
  const matches = await dedupe.companyMatches(db, parsed.data);
  const created = await companies.create(db, parsed.data);
  return c.json(matches.length ? { ...created, possibleDuplicates: matches } : created, 201);
});

companiesRoute.get("/duplicates", async (c) => {
  const db = c.env.DB;
  const groups = await dedupe.groups(db, "company");
  const withRecords = await Promise.all(
    groups.map(async (g) => ({ ...g, companies: (await Promise.all(g.ids.map((id) => companies.get(db, id)))).filter(Boolean) })),
  );
  return c.json({ groups: withRecords, count: withRecords.length });
});

companiesRoute.post("/duplicates", async (c) => {
  const body = await c.req.json().catch(() => null);
  const db = c.env.DB;
  let input: any = null;
  if (body?.id) input = await companies.get(db, body.id);
  else {
    const parsed = CompanyPatch.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    input = parsed.data;
  }
  if (!input) return c.json({ error: "not found" }, 404);
  const matches = await dedupe.companyMatches(db, input, body?.id);
  const out = await Promise.all(matches.map(async (m) => ({ ...m, company: await companies.get(db, m.id) })));
  return c.json({ matches: out, count: out.length });
});

companiesRoute.post("/merge", async (c) => {
  const parsed = MergeInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  try {
    const { ids, keepId, dryRun } = parsed.data;
    return c.json(await dedupe.mergeCompanies(c.env.DB, ids, keepId, dryRun));
  } catch (e) {
    if (e instanceof dedupe.MergeError) return c.json({ error: e.message }, e.status);
    throw e;
  }
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
