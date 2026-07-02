import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ContactList } from "./schema.js";

// File-backed JSON store for list *identity* only. Membership is not stored
// here — it lives on each contact as a `list:<id>` tag (see memberTag), so
// the existing contact tag filter does the member lookups. Mirrors store.ts
// so it can be swapped for the same DB later.
const DATA_FILE = process.env.CONTACTS_LISTS_FILE ?? "./data/lists.json";

async function load(): Promise<ContactList[]> {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8")) as ContactList[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function persist(lists: ContactList[]): Promise<void> {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(lists, null, 2));
}

// A readable, stable id derived from the name — the membership tag becomes
// `list:batch-july-1-2026` rather than an opaque uuid.
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "list";
}

/** The namespaced tag stamped on a contact to mark list membership. */
export const memberTag = (id: string): string => `list:${id}`;

export async function all(): Promise<ContactList[]> {
  return load();
}

export async function get(id: string): Promise<ContactList | null> {
  return (await load()).find((l) => l.id === id) ?? null;
}

export async function create(name: string): Promise<ContactList> {
  const lists = await load();
  const base = slugify(name);
  let id = base;
  let n = 2;
  while (lists.some((l) => l.id === id)) id = `${base}-${n++}`;
  const now = new Date().toISOString();
  const list: ContactList = { id, name, createdAt: now, updatedAt: now };
  lists.push(list);
  await persist(lists);
  return list;
}

export async function rename(id: string, name: string): Promise<ContactList | null> {
  const lists = await load();
  const idx = lists.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  lists[idx] = { ...lists[idx], name, updatedAt: new Date().toISOString() };
  await persist(lists);
  return lists[idx];
}

export async function remove(id: string): Promise<boolean> {
  const lists = await load();
  const next = lists.filter((l) => l.id !== id);
  if (next.length === lists.length) return false;
  await persist(next);
  return true;
}
