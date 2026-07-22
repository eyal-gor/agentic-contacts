import type { Contact, ContactInputT, ContactPatchT } from "./schema.js";
import { jsonList, toJson, buildSet } from "./db.js";

// D1-backed contact store — the swap the file store anticipated. Same five
// functions; each now takes the DB binding, since Workers hands bindings to
// the request rather than the module.

const JSON_FIELDS = ["emails", "phones", "tags"];

function rowToContact(row: Record<string, unknown>): Contact {
  return {
    id: String(row.id),
    name: String(row.name),
    emails: jsonList(row.emails),
    phones: jsonList(row.phones),
    companyId: (row.companyId as string) ?? undefined,
    company: (row.company as string) ?? undefined,
    title: (row.title as string) ?? undefined,
    tags: jsonList(row.tags),
    notes: (row.notes as string) ?? undefined,
    linkedin: (row.linkedin as string) ?? undefined,
    followUpAt: (row.followUpAt as string) ?? null,
    followUpNote: (row.followUpNote as string) ?? null,
    addedBy: (row.addedBy as string) ?? undefined,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export interface ListOptions {
  q?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export async function list(db: D1Database, opts: ListOptions = {}): Promise<Contact[]> {
  const { q, tag, limit = 50, offset = 0 } = opts;
  const where: string[] = [];
  const binds: unknown[] = [];

  if (q) {
    // Same fields the in-memory filter searched. LIKE against the JSON text
    // covers emails/phones — substring matching is what it did before too.
    const cols = ["name", "company", "title", "notes", "emails", "phones"];
    where.push(`(${cols.map((c) => `lower(coalesce(${c}, '')) LIKE ?`).join(" OR ")})`);
    for (let i = 0; i < cols.length; i++) binds.push(`%${q.toLowerCase()}%`);
  }
  if (tag) {
    // tags is a JSON array — match the quoted element so "ai" can't hit "ai-agent".
    where.push("tags LIKE ?");
    binds.push(`%${JSON.stringify(tag)}%`);
  }

  const sql = `SELECT * FROM contacts${where.length ? ` WHERE ${where.join(" AND ")}` : ""} LIMIT ? OFFSET ?`;
  binds.push(limit, offset);
  const { results } = await db.prepare(sql).bind(...binds).all();
  return (results as Record<string, unknown>[]).map(rowToContact);
}

export async function get(db: D1Database, id: string): Promise<Contact | null> {
  const row = await db.prepare("SELECT * FROM contacts WHERE id = ?").bind(id).first();
  return row ? rowToContact(row as Record<string, unknown>) : null;
}

export async function create(db: D1Database, input: ContactInputT): Promise<Contact> {
  const now = new Date().toISOString();
  const contact: Contact = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...input };
  await db
    .prepare(
      `INSERT INTO contacts
        (id, name, emails, phones, companyId, company, title, tags, notes, linkedin, followUpAt, followUpNote, addedBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      contact.id,
      contact.name,
      toJson(contact.emails),
      toJson(contact.phones),
      contact.companyId ?? null,
      contact.company ?? null,
      contact.title ?? null,
      toJson(contact.tags),
      contact.notes ?? null,
      contact.linkedin ?? null,
      contact.followUpAt ?? null,
      contact.followUpNote ?? null,
      contact.addedBy ?? null,
      contact.createdAt,
      contact.updatedAt,
    )
    .run();
  return contact;
}

export async function update(db: D1Database, id: string, patch: ContactPatchT): Promise<Contact | null> {
  const existing = await get(db, id);
  if (!existing) return null;

  const { clause, values } = buildSet(patch as Record<string, unknown>, JSON_FIELDS);
  const updatedAt = new Date().toISOString();
  const sql = clause
    ? `UPDATE contacts SET ${clause}, updatedAt = ? WHERE id = ?`
    : "UPDATE contacts SET updatedAt = ? WHERE id = ?";
  await db.prepare(sql).bind(...values, updatedAt, id).run();
  return get(db, id);
}

export async function remove(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM contacts WHERE id = ?").bind(id).run();
  return (res.meta?.changes ?? 0) > 0;
}
