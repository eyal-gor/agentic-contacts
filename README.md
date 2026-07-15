# Agentic Contacts

API-only contacts + companies service. **TypeScript + Hono** REST API with a thin **CLI** client.
Zero-config to start (file-backed JSON store), with a clean seam to swap in Supabase later.

## Quickstart

```bash
npm install
cp .env.example .env   # optional; defaults work as-is
npm run dev            # API on http://localhost:8787
```

In another terminal, drive it with the CLI:

```bash
npm run cli -- add -n "Ada Lovelace" -e ada@example.com -c "Analytical Engines" -t founder
npm run cli -- list
npm run cli -- company-add -n "Agnost AI" -w https://agnost.ai --status research --tag company-radar
npm run cli -- companies --tag company-radar
npm run cli -- company-get <id>
npm run cli -- list -q ada
npm run cli -- get <id>
npm run cli -- update <id> --title "CTO"
npm run cli -- log <id> -c call -s "Caught up about Q3 plans" --next 2026-07-01
npm run cli -- history <id>
npm run cli -- remind <id> --at 2026-07-01 --note "Follow up on the proposal"
npm run cli -- due --window week
npm run cli -- rm <id>
```

## Data lives in a separate (private) repo

This code is open-source; the data is not. Contacts/companies/interactions are stored as
JSON in a **separate private repo** (e.g. `p_98_contacts_data`), and this app
points at it via env — so the code can be public without shipping anyone's PII.

```bash
# clone your private data repo next to this one
git clone <your-private-data-repo> ../p_98_contacts_data
cp .env.example .env   # then set the paths below
```

```ini
CONTACTS_DATA_FILE=../p_98_contacts_data/contacts.json
COMPANIES_DATA_FILE=../p_98_contacts_data/companies.json
INTERACTIONS_DATA_FILE=../p_98_contacts_data/interactions.json
DATA_GIT_SYNC=1                 # auto commit+push the data repo after edits (debounced)
DATA_GIT_SYNC_DEBOUNCE_MS=10000 # wait this long after the last edit before pushing
```

With `DATA_GIT_SYNC=1`, every mutating request schedules a debounced
`git add -A && commit && push` in the data repo (commit message
`data: sync <timestamp>`). Edits in quick succession collapse into one push.
Leave it `0` to manage the data repo by hand. The data dir is never committed
to *this* repo — `data/` and `.env` are gitignored.

## REST API

| Method | Path             | Body            | Notes                          |
| ------ | ---------------- | --------------- | ------------------------------ |
| GET    | `/health`        | —               | liveness                       |
| GET    | `/companies`     | —               | `?q=`, `?tag=`, `?status=`, paging |
| POST   | `/companies`     | `CompanyInput`  | create → 201; `?upsert=1` updates by exact name |
| GET    | `/companies/:id` | —               | includes matching contacts     |
| PATCH  | `/companies/:id` | `CompanyPatch`  | partial update                 |
| DELETE | `/companies/:id` | —               | 204                            |
| GET    | `/contacts`      | —               | `?q=`, `?tag=`, `?sort=recent\|stale`, `?due=overdue\|today\|week\|all`, paging |
| POST   | `/contacts`      | `ContactInput`  | create → 201                   |
| GET    | `/contacts/:id`  | —               | 404 if missing                 |
| PATCH  | `/contacts/:id`  | `ContactPatch`  | partial update                 |
| DELETE | `/contacts/:id`  | —               | 204; cascades interactions     |
| GET    | `/contacts/:id/interactions` | —   | conversation history, newest first |
| POST   | `/contacts/:id/interactions` | `InteractionInput` | log a conversation → 201 |

`CompanyInput`: `{ name (required), website?, domains[], tags[], notes?, status?, sourceUrl?, fitReason?, suggestedAngle?, confidence? }`

`ContactInput`: `{ name (required), emails[], phones[], companyId?, company?, title?, tags[], notes? }`

`InteractionInput`: `{ summary (required), channel (call|email|meeting|message|note|other), occurredAt? (ISO) }`

`GET /contacts` and `GET /contacts/:id` include a `lastInteraction` field (or `null`).

### Auth

Set `API_KEY` in `.env` to require `Authorization: Bearer <key>` on `/contacts*`, `/companies*`, and `/lists*`.
Left empty, the API is open (dev mode).

## Layout

```
src/
  index.ts          # Hono app + server entry
  schema.ts         # zod schemas + Contact/Company types (single source of truth)
  store.ts          # file-backed JSON store (swap for Supabase here)
  companystore.ts   # file-backed company/account store
  routes/contacts.ts# CRUD + auth middleware
  routes/companies.ts# company/account CRUD
cli/
  contacts.ts       # commander CLI — HTTP client of the REST API
```

## Next steps

- Swap `src/store.ts` for Supabase/Postgres (keep the same async signatures).
- Background enrichment via Inngest; transactional email via Resend (per saved stack).
- Dedupe/merge endpoint; interaction history.
