import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Interaction, InteractionInputT } from "./schema.js";

// Separate file-backed collection for interactions (its own "table"), so it
// maps cleanly onto a Supabase `interactions` table later.
const DATA_FILE = process.env.INTERACTIONS_DATA_FILE ?? "./data/interactions.json";

async function load(): Promise<Interaction[]> {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8")) as Interaction[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function persist(items: Interaction[]): Promise<void> {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(items, null, 2));
}

// Newest first.
export async function listForContact(contactId: string): Promise<Interaction[]> {
  return (await load())
    .filter((i) => i.contactId === contactId)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
}

export async function add(contactId: string, input: InteractionInputT): Promise<Interaction> {
  const items = await load();
  const now = new Date().toISOString();
  const interaction: Interaction = {
    id: randomUUID(),
    contactId,
    channel: input.channel,
    summary: input.summary,
    occurredAt: input.occurredAt ?? now,
    createdAt: now,
  };
  items.push(interaction);
  await persist(items);
  return interaction;
}

// One pass to find the latest interaction per contact — used to enrich list().
export async function lastByContact(): Promise<Record<string, Interaction>> {
  const map: Record<string, Interaction> = {};
  for (const i of await load()) {
    const cur = map[i.contactId];
    if (!cur || i.occurredAt > cur.occurredAt) map[i.contactId] = i;
  }
  return map;
}

// Cascade cleanup when a contact is deleted.
export async function removeForContact(contactId: string): Promise<number> {
  const items = await load();
  const next = items.filter((i) => i.contactId !== contactId);
  const removed = items.length - next.length;
  if (removed) await persist(next);
  return removed;
}
