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
  /**
   * The shared key, from the account-level Secrets Store.
   *
   * One secret, bound by every service that needs it, rotated in one place
   * without redeploying any of them. It used to be a per-Worker secret, which
   * meant the same value copied into each Worker's own store and into several
   * .env files — and nothing to keep those copies equal. They drifted, callers
   * started getting 401s, and because a deployed secret cannot be read back
   * there was no way to find out which copy was the right one.
   */
  API_KEY_STORE?: { get(): Promise<string> };
  /** The old per-Worker secret. Still read, because Secrets Store bindings
   *  are not reachable from local dev — there, this comes from .dev.vars. */
  API_KEY?: string;
  /** Human login for the web UI. Exchanged at /auth/login for a session
   *  token; the key above stays the machine credential. Optional so the API
   *  keeps working key-only until the secret is set. */
  APP_PASSWORD?: string;
  /** Kompany, where the business is actually steered from. The nightly cron
   *  reports the day's networking onto a machine there, so outreach carries a
   *  number and a target instead of a feeling. All optional: without them the
   *  push is skipped and everything else works unchanged. */
  KOMPANY_API_KEY?: string;
  KOMPANY_PROSPECTOR_MACHINE_ID?: string;
  KOMPANY_OUTREACH_MACHINE_ID?: string;
  KOMPANY_URL?: string;
  /** Google OAuth client, for signing the one allowed person in. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** The single Google account permitted. Defaults to Eyal's. */
  ALLOWED_EMAIL?: string;
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
