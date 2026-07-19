import type { Interaction, InteractionInputT } from "./schema.js";

// D1-backed interaction log (conversation history per contact).

function rowToInteraction(row: Record<string, unknown>): Interaction {
  return {
    id: String(row.id),
    contactId: String(row.contactId),
    channel: row.channel as Interaction["channel"],
    summary: String(row.summary),
    occurredAt: String(row.occurredAt),
    createdAt: String(row.createdAt),
  };
}

export async function listForContact(db: D1Database, contactId: string): Promise<Interaction[]> {
  const { results } = await db
    .prepare("SELECT * FROM interactions WHERE contactId = ? ORDER BY occurredAt DESC")
    .bind(contactId)
    .all();
  return (results as Record<string, unknown>[]).map(rowToInteraction);
}

export async function add(db: D1Database, contactId: string, input: InteractionInputT): Promise<Interaction> {
  const now = new Date().toISOString();
  const interaction: Interaction = {
    id: crypto.randomUUID(),
    contactId,
    channel: input.channel,
    summary: input.summary,
    occurredAt: input.occurredAt ?? now,
    createdAt: now,
  };
  await db
    .prepare(
      `INSERT INTO interactions (id, contactId, channel, summary, occurredAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      interaction.id,
      interaction.contactId,
      interaction.channel,
      interaction.summary,
      interaction.occurredAt,
      interaction.createdAt,
    )
    .run();
  return interaction;
}

/** Every interaction (for the calendar / activity views). */
export async function all(db: D1Database): Promise<Interaction[]> {
  const { results } = await db.prepare("SELECT * FROM interactions ORDER BY occurredAt DESC").all();
  return (results as Record<string, unknown>[]).map(rowToInteraction);
}

/**
 * Latest interaction per contact — enriches list().
 * The window function does in SQL what the old one-pass loop did in memory.
 */
export async function lastByContact(db: D1Database): Promise<Record<string, Interaction>> {
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY contactId ORDER BY occurredAt DESC) AS rn
         FROM interactions
       ) WHERE rn = 1`,
    )
    .all();
  const map: Record<string, Interaction> = {};
  for (const row of results as Record<string, unknown>[]) {
    const i = rowToInteraction(row);
    map[i.contactId] = i;
  }
  return map;
}

/** Cascade cleanup when a contact is deleted. */
export async function removeForContact(db: D1Database, contactId: string): Promise<number> {
  const res = await db.prepare("DELETE FROM interactions WHERE contactId = ?").bind(contactId).run();
  return res.meta?.changes ?? 0;
}
