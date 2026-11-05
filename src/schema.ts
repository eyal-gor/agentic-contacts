import { z } from "zod";

// Single source of truth for the Contact shape. Used by the API for
// validation and by the store/CLI for types.
export const ContactInput = z.object({
  name: z.string().min(1, "name is required"),
  // Every address, primary first. emails[0] IS the primary email; the store
  // keeps it in its own indexed column too.
  emails: z.array(z.string().email()).default([]),
  // Optional: make this address the primary one (added if missing, moved to
  // the front if present). Read back as `primaryEmail` on every contact.
  primaryEmail: z.string().email().optional(),
  phones: z.array(z.string()).default([]),
  companyId: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  linkedin: z.string().optional(),
  // "Next talk" reminder: when to next reach out, and what about.
  // nullable so a PATCH can clear it by sending null.
  followUpAt: z.string().nullable().optional(),
  followUpNote: z.string().nullable().optional(),
  // Who created the record — see companies.addedBy.
  addedBy: z.string().optional(),
});

// Every field optional for partial updates.
export const ContactPatch = ContactInput.partial();

export type ContactInputT = z.infer<typeof ContactInput>;
export type ContactPatchT = z.infer<typeof ContactPatch>;

export interface Contact extends Omit<ContactInputT, "primaryEmail"> {
  id: string;
  /** emails[0], or null when the contact has no email. */
  primaryEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

// First-class companies/accounts. Contacts can point at these by companyId;
// company remains on contacts as a denormalized display/search string.
export const CompanyInput = z.object({
  name: z.string().min(1, "name is required"),
  website: z.string().url().optional(),
  domains: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  status: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  fitReason: z.string().optional(),
  suggestedAngle: z.string().optional(),
  confidence: z.string().optional(),
  // Who created the record — "Eyal (person)", "Contact Keeper (system)",
  // "Prospect Hunter (agent)". Set on create; upserts keep the original.
  addedBy: z.string().optional(),
});

export const CompanyPatch = CompanyInput.partial();

export type CompanyInputT = z.infer<typeof CompanyInput>;
export type CompanyPatchT = z.infer<typeof CompanyPatch>;

export interface Company extends CompanyInputT {
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

// POST /contacts/merge and /companies/merge. keepId (default ids[0]) wins
// every field it has a value for; dryRun previews without writing.
export const MergeInput = z.object({
  ids: z.array(z.string()).min(2, "give at least two ids"),
  keepId: z.string().optional(),
  dryRun: z.boolean().default(false),
});
export type MergeInputT = z.infer<typeof MergeInput>;
