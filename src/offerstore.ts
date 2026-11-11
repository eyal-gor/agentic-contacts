// D1-backed offers: what you're selling someone. Most recently used first.
export type Offer = {
  id: string;
  name: string;
  pitch: string;
  icp: string | null;
  uses: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "offer";

const row = (r: Record<string, unknown>): Offer => ({
  id: String(r.id),
  name: String(r.name),
  pitch: String(r.pitch ?? ""),
  icp: r.icp == null ? null : String(r.icp),
  uses: Number(r.uses ?? 0),
  lastUsedAt: r.lastUsedAt == null ? null : String(r.lastUsedAt),
  createdAt: String(r.createdAt),
  updatedAt: String(r.updatedAt),
});

export async function all(db: D1Database): Promise<Offer[]> {
  const { results } = await db.prepare("SELECT * FROM offers ORDER BY COALESCE(lastUsedAt, createdAt) DESC").all();
  return (results as Record<string, unknown>[]).map(row);
}

export async function get(db: D1Database, id: string): Promise<Offer | null> {
  const r = await db.prepare("SELECT * FROM offers WHERE id = ?").bind(id).first();
  return r ? row(r as Record<string, unknown>) : null;
}

export async function create(db: D1Database, input: { name: string; pitch?: string; icp?: string | null; id?: string }): Promise<Offer> {
  const base = input.id ? slugify(input.id) : slugify(input.name);
  let id = base;
  let n = 2;
  while (await get(db, id)) id = `${base}-${n++}`;
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO offers (id, name, pitch, icp, uses, lastUsedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)")
    .bind(id, input.name.trim(), (input.pitch ?? "").trim(), input.icp ?? null, now, now)
    .run();
  return (await get(db, id))!;
}

export async function update(db: D1Database, id: string, patch: { name?: string; pitch?: string; icp?: string | null }): Promise<Offer | null> {
  const o = await get(db, id);
  if (!o) return null;
  const next = { ...o, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  await db
    .prepare("UPDATE offers SET name = ?, pitch = ?, icp = ?, updatedAt = ? WHERE id = ?")
    .bind(String(next.name).trim(), String(next.pitch ?? "").trim(), next.icp ?? null, new Date().toISOString(), id)
    .run();
  return get(db, id);
}

export async function used(db: D1Database, id: string): Promise<Offer | null> {
  await db.prepare("UPDATE offers SET uses = uses + 1, lastUsedAt = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
  return get(db, id);
}

export async function remove(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM offers WHERE id = ?").bind(id).run();
  return (res.meta?.changes ?? 0) > 0;
}
