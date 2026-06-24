import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Contact, ContactInputT, ContactPatchT } from "./schema.js";

// File-backed JSON store. The API is intentionally async so this can be
// swapped for Supabase/Postgres (the saved stack choice) without touching
// the routes — just reimplement these five functions.
const DATA_FILE = process.env.CONTACTS_DATA_FILE ?? "./data/contacts.json";

async function load(): Promise<Contact[]> {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8")) as Contact[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function persist(contacts: Contact[]): Promise<void> {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(contacts, null, 2));
}

export interface ListOptions {
  q?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export async function list(opts: ListOptions = {}): Promise<Contact[]> {
  let contacts = await load();
  const { q, tag, limit = 50, offset = 0 } = opts;
  if (q) {
    const needle = q.toLowerCase();
    contacts = contacts.filter((c) =>
      [c.name, c.company, c.title, c.notes, ...c.emails, ...c.phones]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }
  if (tag) contacts = contacts.filter((c) => c.tags.includes(tag));
  return contacts.slice(offset, offset + limit);
}

export async function get(id: string): Promise<Contact | null> {
  return (await load()).find((c) => c.id === id) ?? null;
}

export async function create(input: ContactInputT): Promise<Contact> {
  const contacts = await load();
  const now = new Date().toISOString();
  const contact: Contact = { id: randomUUID(), createdAt: now, updatedAt: now, ...input };
  contacts.push(contact);
  await persist(contacts);
  return contact;
}

export async function update(id: string, patch: ContactPatchT): Promise<Contact | null> {
  const contacts = await load();
  const idx = contacts.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  contacts[idx] = { ...contacts[idx], ...patch, updatedAt: new Date().toISOString() };
  await persist(contacts);
  return contacts[idx];
}

export async function remove(id: string): Promise<boolean> {
  const contacts = await load();
  const next = contacts.filter((c) => c.id !== id);
  if (next.length === contacts.length) return false;
  await persist(next);
  return true;
}
