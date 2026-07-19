/**
 * D1 helpers shared by the stores.
 *
 * The stores used to read/write whole JSON files; on Workers there is no
 * filesystem, so each entity is a table. Array fields round-trip as JSON text
 * because SQLite has no array type — `jsonList`/`toJson` are the only place
 * that conversion lives.
 */

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  API_KEY: string;
}

/** JSON text column → array. Tolerates NULL and legacy non-array values. */
export function jsonList(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Array → JSON text column. */
export function toJson(value: unknown[] | undefined): string {
  return JSON.stringify(value ?? []);
}

/** Drop undefined so a PATCH only touches the fields it names. */
export function definedEntries<T extends object>(patch: T): [string, unknown][] {
  return Object.entries(patch).filter(([, v]) => v !== undefined);
}

/**
 * Build `SET a = ?, b = ?` plus its bindings from a patch object.
 * `jsonFields` are stringified on the way in.
 */
export function buildSet(
  patch: Record<string, unknown>,
  jsonFields: string[] = [],
): { clause: string; values: unknown[] } {
  const entries = definedEntries(patch);
  const clause = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([k, v]) =>
    jsonFields.includes(k) ? toJson(v as unknown[]) : (v as unknown),
  );
  return { clause, values };
}
