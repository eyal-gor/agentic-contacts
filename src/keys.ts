/**
 * Match keys — the normalized values two records are compared on.
 *
 * Borrowed from Twenty CRM's duplicateCriteria: a person is a duplicate when
 * any ONE of {name}, {linkedin}, {email} matches; a company when {name} or
 * {domain} matches. Matching is exact on the normalized value, and values
 * shorter than 3 characters never match (Twenty's minimum too).
 *
 * Strength matters for automation: email and LinkedIn identify a person, a
 * name does not (two different "David Cohen"s). Upsert only follows STRONG
 * keys; name matches are reported as "possible" for a human to decide.
 */

export type Entity = "contact" | "company";
export type Kind = "email" | "linkedin" | "name" | "domain";
export interface Key {
  kind: Kind;
  value: string;
}

const MIN_LEN = 3;

export const STRONG: Record<Entity, Kind[]> = {
  contact: ["email", "linkedin"],
  // Company Radar has always upserted by name, so name stays strong here.
  company: ["domain", "name"],
};

export function normEmail(e: string | undefined | null): string | null {
  const v = (e ?? "").trim().toLowerCase();
  return v.includes("@") && v.length >= MIN_LEN ? v : null;
}

/** "https://www.linkedin.com/in/Ada-L/?utm=x" → "in/ada-l". */
export function normLinkedin(u: string | undefined | null): string | null {
  let v = (u ?? "").trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^[a-z]+:\/\//, "").replace(/^(www\.|[a-z]{2}\.|m\.)/, "");
  const m = v.match(/linkedin\.com\/(in|company|pub)\/([^/?#]+)/);
  if (m) {
    let slug = m[2];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      /* keep raw */
    }
    return `${m[1]}/${slug}`;
  }
  v = v.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return v.length >= MIN_LEN ? v : null;
}

export function normName(n: string | undefined | null): string | null {
  const v = (n ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return v.length >= MIN_LEN ? v : null;
}

/** "https://www.Acme.com/about" → "acme.com". Bare domains pass through. */
export function normDomain(u: string | undefined | null): string | null {
  let v = (u ?? "").trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/[/?#:].*$/, "");
  return v.includes(".") && v.length >= MIN_LEN ? v : null;
}

function uniq(keys: (Key | null)[]): Key[] {
  const seen = new Set<string>();
  const out: Key[] = [];
  for (const k of keys) {
    if (!k) continue;
    const id = `${k.kind}:${k.value}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(k);
    }
  }
  return out;
}

const key = (kind: Kind, value: string | null): Key | null => (value ? { kind, value } : null);

export function contactKeys(c: { name?: string; emails?: string[]; linkedin?: string | null }): Key[] {
  return uniq([
    ...(c.emails ?? []).map((e) => key("email", normEmail(e))),
    key("linkedin", normLinkedin(c.linkedin)),
    key("name", normName(c.name)),
  ]);
}

export function companyKeys(c: { name?: string; website?: string | null; domains?: string[] }): Key[] {
  return uniq([
    key("name", normName(c.name)),
    key("domain", normDomain(c.website)),
    ...(c.domains ?? []).map((d) => key("domain", normDomain(d))),
  ]);
}

/** Replace a record's keys. Called by the stores on every create/update. */
export async function writeKeys(db: D1Database, entity: Entity, id: string, keys: Key[]): Promise<void> {
  const stmts = [db.prepare("DELETE FROM match_keys WHERE entity = ? AND entityId = ?").bind(entity, id)];
  for (const k of keys) {
    stmts.push(
      db
        .prepare("INSERT OR IGNORE INTO match_keys (entity, entityId, kind, value) VALUES (?, ?, ?, ?)")
        .bind(entity, id, k.kind, k.value),
    );
  }
  await db.batch(stmts);
}

export async function deleteKeys(db: D1Database, entity: Entity, id: string): Promise<void> {
  await db.prepare("DELETE FROM match_keys WHERE entity = ? AND entityId = ?").bind(entity, id).run();
}

/**
 * Rebuild every key from the tables. Raw SQL rather than the stores, so this
 * module stays import-free of them (the stores import it).
 */
export async function rebuildAll(db: D1Database): Promise<{ contacts: number; companies: number }> {
  const parse = (v: unknown): string[] => {
    try {
      const a = JSON.parse(String(v ?? "[]"));
      return Array.isArray(a) ? a.map(String) : [];
    } catch {
      return [];
    }
  };
  const [ct, co] = await Promise.all([
    db.prepare("SELECT id, name, emails, linkedin FROM contacts").all<Record<string, string>>(),
    db.prepare("SELECT id, name, website, domains FROM companies").all<Record<string, string>>(),
  ]);
  const stmts = [db.prepare("DELETE FROM match_keys")];
  const ins = (entity: string, id: string, k: Key) =>
    db
      .prepare("INSERT OR IGNORE INTO match_keys (entity, entityId, kind, value) VALUES (?, ?, ?, ?)")
      .bind(entity, id, k.kind, k.value);
  for (const r of ct.results)
    for (const k of contactKeys({ name: r.name, emails: parse(r.emails), linkedin: r.linkedin }))
      stmts.push(ins("contact", r.id, k));
  for (const r of co.results)
    for (const k of companyKeys({ name: r.name, website: r.website, domains: parse(r.domains) }))
      stmts.push(ins("company", r.id, k));
  // Marker row: "the table reflects every record", so ensureIndexed can
  // tell a complete index from one that only holds rows written since.
  stmts.push(db.prepare("INSERT INTO match_keys VALUES ('_meta', 'index', 'built', ?)").bind(new Date().toISOString()));
  for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500));
  return { contacts: ct.results.length, companies: co.results.length };
}

let indexedThisIsolate = false;

/** Build the index once, the first time anything matches against it. */
export async function ensureIndexed(db: D1Database): Promise<void> {
  if (indexedThisIsolate) return;
  const marker = await db.prepare("SELECT 1 FROM match_keys WHERE entity = '_meta' LIMIT 1").first();
  if (!marker) await rebuildAll(db);
  indexedThisIsolate = true;
}

export interface Match {
  id: string;
  matchedOn: Key[];
  strong: boolean;
}

/** Records of `entity` sharing any of `keys`, grouped per record. */
export async function findMatches(
  db: D1Database,
  entity: Entity,
  keys: Key[],
  excludeId?: string,
): Promise<Match[]> {
  if (!keys.length) return [];
  await ensureIndexed(db);
  const cond = keys.map(() => "(kind = ? AND value = ?)").join(" OR ");
  const binds: unknown[] = [entity, ...keys.flatMap((k) => [k.kind, k.value])];
  const { results } = await db
    .prepare(`SELECT entityId, kind, value FROM match_keys WHERE entity = ? AND (${cond})`)
    .bind(...binds)
    .all<{ entityId: string; kind: Kind; value: string }>();
  const byId = new Map<string, Key[]>();
  for (const r of results) {
    if (r.entityId === excludeId) continue;
    if (!byId.has(r.entityId)) byId.set(r.entityId, []);
    byId.get(r.entityId)!.push({ kind: r.kind, value: r.value });
  }
  return [...byId.entries()]
    .map(([id, matchedOn]) => ({ id, matchedOn, strong: matchedOn.some((k) => STRONG[entity].includes(k.kind)) }))
    .sort((a, b) => Number(b.strong) - Number(a.strong) || b.matchedOn.length - a.matchedOn.length);
}
