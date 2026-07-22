import type { Company, CompanyInputT, CompanyPatchT } from "./schema.js";
import { jsonList, toJson, buildSet } from "./db.js";

// D1-backed company store. `upsertByName` is the one Company Radar calls
// (POST /companies?upsert=1), so it stays idempotent by folded name.

const JSON_FIELDS = ["domains", "tags"];

function rowToCompany(row: Record<string, unknown>): Company {
  return {
    id: String(row.id),
    name: String(row.name),
    website: (row.website as string) ?? undefined,
    domains: jsonList(row.domains),
    tags: jsonList(row.tags),
    notes: (row.notes as string) ?? undefined,
    status: (row.status as string) ?? undefined,
    sourceUrl: (row.sourceUrl as string) ?? undefined,
    fitReason: (row.fitReason as string) ?? undefined,
    suggestedAngle: (row.suggestedAngle as string) ?? undefined,
    confidence: (row.confidence as string) ?? undefined,
    addedBy: (row.addedBy as string) ?? undefined,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export interface ListOptions {
  q?: string;
  tag?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function list(db: D1Database, opts: ListOptions = {}): Promise<Company[]> {
  const { q, tag, status, limit = 50, offset = 0 } = opts;
  const where: string[] = [];
  const binds: unknown[] = [];

  if (q) {
    const cols = ["name", "website", "notes", "status", "fitReason", "suggestedAngle", "sourceUrl", "domains", "tags"];
    where.push(`(${cols.map((c) => `lower(coalesce(${c}, '')) LIKE ?`).join(" OR ")})`);
    for (let i = 0; i < cols.length; i++) binds.push(`%${q.toLowerCase()}%`);
  }
  if (tag) {
    where.push("tags LIKE ?");
    binds.push(`%${JSON.stringify(tag)}%`);
  }
  if (status) {
    where.push("status = ?");
    binds.push(status);
  }

  const sql = `SELECT * FROM companies${where.length ? ` WHERE ${where.join(" AND ")}` : ""} LIMIT ? OFFSET ?`;
  binds.push(limit, offset);
  const { results } = await db.prepare(sql).bind(...binds).all();
  return (results as Record<string, unknown>[]).map(rowToCompany);
}

export async function get(db: D1Database, id: string): Promise<Company | null> {
  const row = await db.prepare("SELECT * FROM companies WHERE id = ?").bind(id).first();
  return row ? rowToCompany(row as Record<string, unknown>) : null;
}

export async function findByName(db: D1Database, name: string): Promise<Company | null> {
  const row = await db
    .prepare("SELECT * FROM companies WHERE lower(trim(name)) = ? LIMIT 1")
    .bind(name.trim().toLowerCase())
    .first();
  return row ? rowToCompany(row as Record<string, unknown>) : null;
}

export async function create(db: D1Database, input: CompanyInputT): Promise<Company> {
  const now = new Date().toISOString();
  const company: Company = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...input };
  await db
    .prepare(
      `INSERT INTO companies
        (id, name, website, domains, tags, notes, status, sourceUrl, fitReason, suggestedAngle, confidence, addedBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      company.id,
      company.name,
      company.website ?? null,
      toJson(company.domains),
      toJson(company.tags),
      company.notes ?? null,
      company.status ?? null,
      company.sourceUrl ?? null,
      company.fitReason ?? null,
      company.suggestedAngle ?? null,
      company.confidence ?? null,
      company.addedBy ?? null,
      company.createdAt,
      company.updatedAt,
    )
    .run();
  return company;
}

export async function update(db: D1Database, id: string, patch: CompanyPatchT): Promise<Company | null> {
  const existing = await get(db, id);
  if (!existing) return null;

  const { clause, values } = buildSet(patch as Record<string, unknown>, JSON_FIELDS);
  const updatedAt = new Date().toISOString();
  const sql = clause
    ? `UPDATE companies SET ${clause}, updatedAt = ? WHERE id = ?`
    : "UPDATE companies SET updatedAt = ? WHERE id = ?";
  await db.prepare(sql).bind(...values, updatedAt, id).run();
  return get(db, id);
}

export async function upsertByName(db: D1Database, input: CompanyInputT): Promise<Company> {
  const existing = await findByName(db, input.name);
  if (!existing) return create(db, input);
  // Union the tags so a re-scan adds labels instead of dropping earlier ones.
  const patch: CompanyPatchT = {
    ...input,
    tags: [...new Set([...(existing.tags || []), ...(input.tags || [])])],
  };
  // Provenance is create-time truth: a later upsert never rewrites who
  // originally added the record.
  if (existing.addedBy) delete patch.addedBy;
  return (await update(db, existing.id, patch))!;
}

export async function remove(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM companies WHERE id = ?").bind(id).run();
  return (res.meta?.changes ?? 0) > 0;
}
