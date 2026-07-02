import { z } from "zod";

// Single source of truth for the Contact shape. Used by the API for
// validation and by the store/CLI for types.
export const ContactInput = z.object({
  name: z.string().min(1, "name is required"),
  emails: z.array(z.string().email()).default([]),
  phones: z.array(z.string()).default([]),
  company: z.string().optional(),
  title: z.string().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  linkedin: z.string().optional(),
  // "Next talk" reminder: when to next reach out, and what about.
  // nullable so a PATCH can clear it by sending null.
  followUpAt: z.string().nullable().optional(),
  followUpNote: z.string().nullable().optional(),
});

// Every field optional for partial updates.
export const ContactPatch = ContactInput.partial();

export type ContactInputT = z.infer<typeof ContactInput>;
export type ContactPatchT = z.infer<typeof ContactPatch>;

export interface Contact extends ContactInputT {
  id: string;
  createdAt: string;
  updatedAt: string;
}

// A logged conversation / touchpoint with a contact.
export const InteractionInput = z.object({
  channel: z.enum(["call", "email", "meeting", "message", "note", "other"]).default("note"),
  summary: z.string().min(1, "summary is required"),
  // ISO timestamp of when it happened; defaults to now on the server.
  occurredAt: z.string().optional(),
});

export type InteractionInputT = z.infer<typeof InteractionInput>;

// A named list / batch of contacts (e.g. "Batch — July 1 2026"). Only the
// list's identity lives here; membership is stored on each contact as a
// namespaced `list:<id>` tag — the same coexist-without-a-schema-change
// trick used for stage:/icp:, so the existing tag filter finds members.
export const ListInput = z.object({ name: z.string().min(1, "name is required") });
export type ListInputT = z.infer<typeof ListInput>;

export interface ContactList {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Interaction {
  id: string;
  contactId: string;
  channel: InteractionInputT["channel"];
  summary: string;
  occurredAt: string;
  createdAt: string;
}
