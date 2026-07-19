import type { ContactList } from "./schema.js";

// D1-backed list store. Membership still lives as a `list:<id>` tag on each
// contact — only the list's identity is a row here.

// A readable, stable id derived from the name — the membership tag becomes
// `list:batch-july-1-2026` rather than an opaque uuid.
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "list";
}

/** The namespaced tag stamped on a contact to mark list membership. */
export const memberTag = (id: string): string => `list:${id}`;

function rowToList(row: Record<string, unknown>): ContactList {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export async function all(db: D1Database): Promise<ContactList[]> {
  const { results } = await db.prepare("SELECT * FROM lists ORDER BY createdAt DESC").all();
  return (results as Record<string, unknown>[]).map(rowToList);
}

export async function get(db: D1Database, id: string): Promise<ContactList | null> {
  const row = await db.prepare("SELECT * FROM lists WHERE id = ?").bind(id).first();
  return row ? rowToList(row as Record<string, unknown>) : null;
}

export async function create(db: D1Database, name: string): Promise<ContactList> {
  // Keep the slug unique by suffixing, exactly as the file store did.
  const base = slugify(name);
  let id = base;
  let n = 2;
  while (await get(db, id)) id = `${base}-${n++}`;

  const now = new Date().toISOString();
  const list: ContactList = { id, name, createdAt: now, updatedAt: now };
  await db
    .prepare("INSERT INTO lists (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)")
    .bind(list.id, list.name, list.createdAt, list.updatedAt)
    .run();
  return list;
}

export async function rename(db: D1Database, id: string, name: string): Promise<ContactList | null> {
  const existing = await get(db, id);
  if (!existing) return null;
  const updatedAt = new Date().toISOString();
  await db.prepare("UPDATE lists SET name = ?, updatedAt = ? WHERE id = ?").bind(name, updatedAt, id).run();
  return { ...existing, name, updatedAt };
}

export async function remove(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM lists WHERE id = ?").bind(id).run();
  return (res.meta?.changes ?? 0) > 0;
}
