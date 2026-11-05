# Lessons from Twenty CRM

Source: `reference/twenty` (shallow clone of github.com/twentyhq/twenty, gitignored).
Paths below are relative to `reference/twenty/packages/` (`S` = `twenty-server/src`).

## Ranked ideas for Agentic Contacts

### 1. Agent rules served by the API
`S/engine/api/mcp/utils/build-mcp-server-instructions.util.ts`. Every agent that connects gets the same rules:
- Look up a record by name to get its id, then act on the id.
- Search results default to 10, and the agent always reports the total.
- Delete: run the same search first, state the count, and wait for confirmation.
- Merge: run a dry run first, then ask which record wins.
- Never copy fields across and delete the other record (linked records are lost).
- Use batch calls instead of loops.

→ Add `GET /instructions` and have the `/contacts` skill read it.

### 2. Duplicate criteria, upsert and merge
- Rules are in `S/engine/workspace-manager/twenty-standard-application/utils/object-metadata/create-standard-flat-object-metadata.util.ts`:
  - Person matches on `[first+last]` OR `[linkedin]` OR `[primaryEmail]`.
  - Company matches on `[name]` OR `[domain]`.
  - Exact match only, and values shorter than 3 characters are skipped.
- Create calls take `?upsert=true`. There is also a `POST /contacts/duplicates` endpoint.
- Merge takes `ids` plus the index of the winning record, with an optional `dryRun`.
  - Each field keeps the winner's value, or else the first non-empty one.
  - Email and phone lists are combined: one primary, the rest go to additional (`merge-emails-field-values.util.ts`).
  - Linked records are moved to the winner.

### 3. Structured provenance instead of free-text `addedBy`
- `twenty-shared/src/types/composite-types/actor.composite-type.ts` defines `{source, name}`.
- Sources: `MANUAL | AGENT | API | IMPORT | EMAIL | CALENDAR | SYSTEM | WEBHOOK`.
- Stored as both `createdBy` and `updatedBy`.

### 4. Primary email column
- Split `emails[]` into `primary_email` (indexed, can be unique) and `additional_emails` (JSON).
- Phones get the same split, with a country code.
- Twenty stores these subfields as flat columns, not a JSON blob.

### 5. Activity timeline (audit log)
- `S/modules/timeline/`. Each row holds an event (`contact.updated`) and `diff {field: {before, after}}`.
- Rows also hold the actor, a linked record and its cached name.
- Changes with the same record, actor and event within 10 minutes are merged into one row.
- Keep `interactions` for real conversations; the timeline holds system changes.

### 6. Noise filters, if we ever ingest Gmail or calendar
- Group / no-reply address regex: `S/modules/messaging/message-import-manager/utils/is-group-email.ts`.
- Bulk mail headers: `List-Unsubscribe`, `List-Id`, `Precedence: bulk`, `Auto-Submitted`.
- Policy: only people *I emailed* become contacts (the `SENT` setting).
- Blocklist entries can be an exact email or `@domain`, which also covers subdomains.

### 7. Company from email domain
- Free-email provider list (~16k entries): `S/utils/email-providers.ts`.
- `psl` package for the root domain, so `mail.acme.co.uk` becomes `acme.co.uk` and the name "Acme".
- Logo: `https://twenty-icons.com/<domain>`.

### 8. Search
- Prefix match on every word, indexed over name, title, emails, the **email domain alone** and company.
- In D1 this means FTS5 with bm25 ranking.

### 9. Smaller things
- Soft delete (`deleted_at`) with a restore endpoint, and partial unique indexes.
- Float `position` column, so reordering never renumbers other rows.
- List membership in a real `list_members(list_id, contact_id, position)` table instead of `list:` tags.
- Follow-ups as tasks: `dueAt`, `status`, and one or more linked contacts or companies. This allows several follow-ups per contact.
- Filter syntax `field[op]:value`, with `and()`, `or()` and `not()`.
- Paging returns `total`.
- Webhooks signed with HMAC.
- CLI output as a table, `--json` or `--ndjson`, plus a `--no-input` flag that exits with code 2 when a value is missing.

### 10. Skills to rewrite as ours
In `S/engine/workspace-manager/twenty-standard-application/utils/skill-metadata/create-standard-flat-skill-metadata.util.ts`:
- **enrich**: fill only empty fields, cite a source for each, show proposed changes, ask before writing. "An empty field beats a wrong one."
- **crm-hygiene**: find duplicates, then merge with a dry run.

The output contract is in `twenty-claude-skills/skills/twenty-record-presentation/SKILL.md`:
- Lead with the count.
- Use a table for 2–10 records.
- Make record names links.
- Never show raw ISO dates.

## Skip
- The custom objects and fields metadata engine.
- The per-workspace Postgres schemas.
- The workflow engine.
- The generated GraphQL SDKs.

All of these are too heavy for a personal app.
