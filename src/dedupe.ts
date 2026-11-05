/**
 * Duplicates: find them, upsert around them, merge them.
 *
 * Patterns from Twenty CRM (common-merge-many-query-runner,
 * merge-emails-field-values):
 *  - the kept record wins every field it has a value for; an empty field
 *    takes the first non-empty value from the others;
 *  - list fields (emails, phones, tags, domains) are combined, kept record's
 *    values first — so its primary email stays primary;
 *  - linked records (interactions, a company's contacts) move to the kept
 *    record before the others are deleted, so nothing linked is lost;
 *  - dryRun returns exactly what a real merge would write.
 * One deliberate difference: notes are concatenated instead of first-wins,
 * because notes are hand-written and losing one is worse than a long note.
 */
import type { Company, CompanyInputT, Contact, ContactInputT, ContactPatchT } from "./schema.js";
import * as contacts from "./store.js";
import * as companies from "./companystore.js";
import { companyKeys, contactKeys, ensureIndexed, findMatches, STRONG, type Entity, type Key } from "./keys.js";

const empty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

function unionBy(lists: (string[] | undefined)[], norm: (s: string) => string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lists)
    for (const v of l ?? []) {
      const k = norm(v);
      if (k && !seen.has(k)) {
        seen.add(k);
        out.push(v);
      }
    }
  return out;
}
const lower = (s: string) => s.trim().toLowerCase();
const digits = (s: string) => s.replace(/[^\d+]/g, "");

function joinNotes(notes: (string | undefined)[]): string | undefined {
  const parts = unionBy(notes.map((n) => (n && n.trim() ? [n.trim()] : [])), (s) => s);
  return parts.length ? parts.join("\n\n") : undefined;
}

function firstFilled<T, K extends keyof T>(records: T[], field: K): T[K] | undefined {
  for (const r of records) if (!empty(r[field])) return r[field];
  return undefined;
}

// --- Finding duplicates ----------------------------------------------------

export interface DuplicateGroup {
  ids: string[];
  matchedOn: Key[];
  /** true when the group is joined by an email/LinkedIn/domain, not just a name. */
  strong: boolean;
}

/** Every set of records that share a key, joined transitively (union-find). */
export async function groups(db: D1Database, entity: Entity): Promise<DuplicateGroup[]> {
  await ensureIndexed(db);
  const { results } = await db
    .prepare(
      `SELECT kind, value, group_concat(entityId) AS ids FROM match_keys
       WHERE entity = ? GROUP BY kind, value HAVING count(*) > 1`,
    )
    .bind(entity)
    .all<{ kind: Key["kind"]; value: string; ids: string }>();

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const r of results) {
    const ids = r.ids.split(",");
    for (const id of ids.slice(1)) parent.set(find(id), find(ids[0]));
  }
  const byRoot = new Map<string, DuplicateGroup>();
  for (const r of results) {
    const root = find(r.ids.split(",")[0]);
    if (!byRoot.has(root)) byRoot.set(root, { ids: [], matchedOn: [], strong: false });
    const g = byRoot.get(root)!;
    for (const id of r.ids.split(",")) if (!g.ids.includes(id)) g.ids.push(id);
    g.matchedOn.push({ kind: r.kind, value: r.value });
    if (STRONG[entity].includes(r.kind)) g.strong = true;
  }
  return [...byRoot.values()].sort((a, b) => Number(b.strong) - Number(a.strong) || b.ids.length - a.ids.length);
}

/** Existing contacts the given input would duplicate. */
export async function contactMatches(db: D1Database, input: Partial<ContactInputT>, excludeId?: string) {
  const emails = contacts.orderEmails(input.emails, input.primaryEmail);
  return findMatches(db, "contact", contactKeys({ ...input, emails }), excludeId);
}

export async function companyMatches(db: D1Database, input: Partial<CompanyInputT>, excludeId?: string) {
  return findMatches(db, "company", companyKeys(input), excludeId);
}

// --- Upsert ------------------------------------------------------------------

export type UpsertResult =
  | { action: "created" | "updated"; contact: Contact; matchedOn: Key[] }
  | { action: "ambiguous"; candidates: { id: string; matchedOn: Key[] }[] };

/**
 * Create, or update the one existing contact that shares an email or LinkedIn.
 * Names never trigger an update (they're reported as possibleDuplicates).
 * Lists combine; given scalar fields (except name) overwrite; notes are appended; addedBy
 * keeps the original creator.
 */
export async function upsertContact(db: D1Database, input: ContactInputT): Promise<UpsertResult> {
  const strong = (await contactMatches(db, input)).filter((m) => m.strong);
  if (strong.length > 1) {
    return { action: "ambiguous", candidates: strong.map(({ id, matchedOn }) => ({ id, matchedOn })) };
  }
  if (!strong.length) return { action: "created", contact: await contacts.create(db, input), matchedOn: [] };

  const existing = (await contacts.get(db, strong[0].id))!;
  const patch: ContactPatchT = { ...input };
  // The email/LinkedIn already identified who this is; an agent's shorter or
  // differently spelled name must not rename them. Rename with PATCH.
  delete patch.name;
  delete patch.addedBy;
  patch.emails = unionBy([existing.emails, input.emails], lower);
  patch.primaryEmail = input.primaryEmail ?? existing.primaryEmail ?? undefined;
  patch.phones = unionBy([existing.phones, input.phones], digits);
  patch.tags = unionBy([existing.tags, input.tags], (s) => s);
  patch.notes = joinNotes([existing.notes, input.notes]);
  for (const k of Object.keys(patch) as (keyof ContactPatchT)[]) if (patch[k] === undefined) delete patch[k];
  const contact = (await contacts.update(db, existing.id, patch))!;
  return { action: "updated", contact, matchedOn: strong[0].matchedOn };
}

// --- Merge -------------------------------------------------------------------

export class MergeError extends Error {
  constructor(message: string, public status: 400 | 404 = 400) {
    super(message);
  }
}

async function loadAll<T extends { id: string }>(
  ids: string[],
  keepId: string | undefined,
  get: (id: string) => Promise<T | null>,
): Promise<{ keep: T; others: T[] }> {
  const unique = [...new Set(ids)];
  if (unique.length < 2) throw new MergeError("give at least two different ids");
  const winner = keepId ?? unique[0];
  if (!unique.includes(winner)) throw new MergeError("keepId must be one of ids");
  const rows = await Promise.all(unique.map(get));
  const missing = unique.filter((_, i) => !rows[i]);
  if (missing.length) throw new MergeError(`not found: ${missing.join(", ")}`, 404);
  const all = rows as T[];
  return { keep: all.find((r) => r.id === winner)!, others: all.filter((r) => r.id !== winner) };
}

const earliest = (dates: string[]) => dates.reduce((a, b) => (a < b ? a : b));

export async function mergeContacts(db: D1Database, ids: string[], keepId?: string, dryRun = false) {
  const { keep, others } = await loadAll(ids, keepId, (id) => contacts.get(db, id));
  const ordered = [keep, ...others];
  const otherIds = others.map((o) => o.id);

  const merged: Contact = { ...keep };
  for (const f of ["companyId", "company", "title", "linkedin", "followUpAt", "followUpNote", "addedBy"] as const) {
    if (empty(merged[f])) (merged as any)[f] = firstFilled(ordered, f);
  }
  merged.emails = unionBy(ordered.map((c) => c.emails), lower);
  merged.primaryEmail = merged.emails[0] ?? null;
  merged.phones = unionBy(ordered.map((c) => c.phones), digits);
  merged.tags = unionBy(ordered.map((c) => c.tags), (s) => s);
  merged.notes = joinNotes(ordered.map((c) => c.notes));
  merged.createdAt = earliest(ordered.map((c) => c.createdAt));

  const ph = otherIds.map(() => "?").join(",");
  const moved = await db
    .prepare(`SELECT count(*) AS n FROM interactions WHERE contactId IN (${ph})`)
    .bind(...otherIds)
    .first<{ n: number }>();
  const plan = { kept: merged, deleted: otherIds, interactionsMoved: moved?.n ?? 0, dryRun };
  if (dryRun) return plan;

  const { id: _id, createdAt, updatedAt: _u, primaryEmail: _pe, ...fields } = merged;
  await contacts.update(db, keep.id, fields);
  await db.batch([
    db.prepare(`UPDATE interactions SET contactId = ? WHERE contactId IN (${ph})`).bind(keep.id, ...otherIds),
    db.prepare("UPDATE contacts SET createdAt = ? WHERE id = ?").bind(createdAt, keep.id),
  ]);
  for (const id of otherIds) await contacts.remove(db, id);
  return { ...plan, kept: await contacts.get(db, keep.id) };
}

export async function mergeCompanies(db: D1Database, ids: string[], keepId?: string, dryRun = false) {
  const { keep, others } = await loadAll(ids, keepId, (id) => companies.get(db, id));
  const ordered = [keep, ...others];
  const otherIds = others.map((o) => o.id);

  const merged: Company = { ...keep };
  for (const f of ["website", "status", "sourceUrl", "fitReason", "suggestedAngle", "confidence", "addedBy"] as const) {
    if (empty(merged[f])) (merged as any)[f] = firstFilled(ordered, f);
  }
  merged.domains = unionBy(ordered.map((c) => c.domains), lower);
  merged.tags = unionBy(ordered.map((c) => c.tags), (s) => s);
  merged.notes = joinNotes(ordered.map((c) => c.notes));
  merged.createdAt = earliest(ordered.map((c) => c.createdAt));

  const ph = otherIds.map(() => "?").join(",");
  const moved = await db
    .prepare(`SELECT count(*) AS n FROM contacts WHERE companyId IN (${ph})`)
    .bind(...otherIds)
    .first<{ n: number }>();
  const plan = { kept: merged, deleted: otherIds, contactsMoved: moved?.n ?? 0, dryRun };
  if (dryRun) return plan;

  const { id: _id, createdAt, updatedAt: _u, ...fields } = merged;
  await companies.update(db, keep.id, fields);
  await db.batch([
    db
      .prepare(`UPDATE contacts SET companyId = ?, company = ? WHERE companyId IN (${ph})`)
      .bind(keep.id, keep.name, ...otherIds),
    db.prepare("UPDATE companies SET createdAt = ? WHERE id = ?").bind(createdAt, keep.id),
  ]);
  for (const id of otherIds) await companies.remove(db, id);
  return { ...plan, kept: await companies.get(db, keep.id) };
}
