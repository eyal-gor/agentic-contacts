import type { Env } from "./db.js";

/**
 * Named API keys — the machine credentials the Settings screen manages.
 *
 * A key is `ac_live_<48 hex>`. The table stores its SHA-256 and a display
 * prefix; the plaintext exists only in the mint response. Revocation is a
 * timestamp, not a delete, so the list remembers what used to exist.
 */

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export async function hashKey(key: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function listKeys(env: Env): Promise<ApiKeyRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, name, prefix, createdAt, lastUsedAt, revokedAt FROM api_keys ORDER BY createdAt DESC",
  ).all();
  return results as unknown as ApiKeyRow[];
}

export async function mintKey(env: Env, name: string): Promise<{ row: ApiKeyRow; key: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const key = "ac_live_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const row: ApiKeyRow = {
    id: crypto.randomUUID(),
    name,
    prefix: key.slice(0, 16) + "…",
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
  await env.DB.prepare(
    "INSERT INTO api_keys (id, name, keyHash, prefix, createdAt) VALUES (?, ?, ?, ?, ?)",
  ).bind(row.id, row.name, await hashKey(key), row.prefix, row.createdAt).run();
  return { row, key };
}

export async function revokeKey(env: Env, id: string): Promise<boolean> {
  const res = await env.DB.prepare(
    "UPDATE api_keys SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL",
  ).bind(new Date().toISOString(), id).run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Is this bearer a live minted key? Returns the row id for usage stamping. */
export async function verifyMintedKey(env: Env, key: string): Promise<string | null> {
  if (!key.startsWith("ac_")) return null;
  const row = await env.DB.prepare(
    "SELECT id FROM api_keys WHERE keyHash = ? AND revokedAt IS NULL",
  ).bind(await hashKey(key)).first<{ id: string }>();
  return row?.id ?? null;
}

export function stampUsage(env: Env, id: string): Promise<unknown> {
  return env.DB.prepare("UPDATE api_keys SET lastUsedAt = ? WHERE id = ?")
    .bind(new Date().toISOString(), id).run();
}
