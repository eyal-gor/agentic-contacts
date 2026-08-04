import { Hono } from "hono";
import * as store from "./store.js";
import * as interactions from "./interactions.js";
import { requireApiKey } from "./auth.js";
import type { Env } from "./db.js";
import type { Contact, ContactPatchT } from "./schema.js";

/**
 * MCP endpoint — the "agentic" in Agentic Contacts.
 *
 * Any MCP client holding the API key (a Claude session, a cerver agent, a
 * script) can search people, read a full dossier, log what happened, and ask
 * who's due today. Streamable-HTTP transport in its stateless form: every
 * request is one JSON-RPC message answered with one JSON body. No SSE, no
 * session state — the data layer is the state.
 *
 * Connect with:
 *   claude mcp add contacts --transport http \
 *     https://agentic-contacts.gneyal.workers.dev/mcp \
 *     --header "Authorization: Bearer $CONTACTS_API_KEY"
 */
export const mcp = new Hono<{ Bindings: Env }>();

const PROTOCOL = "2025-06-18";
const PIPELINE_STAGES = ["lead", "contacted", "call", "trial", "proposal"];
const CHANNELS = ["call", "email", "meeting", "message", "note"];

/** The compact shape agents work with — enough to decide, cheap to read. */
function card(c: Contact) {
  return {
    id: c.id,
    name: c.name,
    title: c.title,
    company: c.company,
    emails: c.emails,
    phones: c.phones,
    tags: c.tags,
    followUpAt: c.followUpAt,
    followUpNote: c.followUpNote,
    notes: c.notes,
  };
}

const TOOLS = [
  {
    name: "search_contacts",
    description:
      "Search the address book by free text (name, company, title, notes, email, phone) and/or a tag. Returns compact contact cards including each contact's id — use get_contact for full history.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search" },
        tag: { type: "string", description: "Exact tag, e.g. stage:lead, icp:dev" },
        limit: { type: "number", description: "Max results (default 25)" },
      },
    },
  },
  {
    name: "get_contact",
    description:
      "Full dossier for one contact: every stored field plus the complete interaction history, newest first.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Contact id (from search_contacts)" } },
      required: ["id"],
    },
  },
  {
    name: "log_interaction",
    description:
      "Record that a conversation happened (call/email/meeting/message/note) and optionally set the next follow-up date. This is how outreach, replies and meetings enter the shared history.",
    inputSchema: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        channel: { type: "string", enum: CHANNELS },
        summary: { type: "string", description: "One line: what happened" },
        followUpAt: { type: "string", description: "Next follow-up, YYYY-MM-DD (optional)" },
        followUpNote: { type: "string", description: "What the follow-up is about (optional)" },
      },
      required: ["contactId", "channel", "summary"],
    },
  },
  {
    name: "add_contact",
    description: "Add a person to the address book.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        emails: { type: "array", items: { type: "string" } },
        phones: { type: "array", items: { type: "string" } },
        company: { type: "string" },
        title: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
        linkedin: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_contact",
    description:
      "Update fields on an existing contact (title, company, tags, notes, follow-up…). Only the fields you pass change.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        emails: { type: "array", items: { type: "string" } },
        phones: { type: "array", items: { type: "string" } },
        company: { type: "string" },
        title: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
        linkedin: { type: "string" },
        followUpAt: { type: ["string", "null"], description: "YYYY-MM-DD, or null to clear" },
        followUpNote: { type: ["string", "null"] },
      },
      required: ["id"],
    },
  },
  {
    name: "who_to_contact_today",
    description:
      "The daily queue, same tiers as the app's Today view: follow-ups overdue, follow-ups due today, and pipeline contacts with no next step set.",
    inputSchema: { type: "object", properties: {} },
  },
];

/* eslint-disable @typescript-eslint/no-explicit-any */
async function callTool(env: Env, name: string, args: any): Promise<unknown> {
  const db = env.DB;
  switch (name) {
    case "search_contacts": {
      const rows = await store.list(db, {
        q: args?.query || undefined,
        tag: args?.tag || undefined,
        limit: Math.min(Number(args?.limit) || 25, 200),
      });
      return { count: rows.length, contacts: rows.map(card) };
    }
    case "get_contact": {
      const c = await store.get(db, String(args?.id ?? ""));
      if (!c) throw new Error(`no contact with id ${args?.id}`);
      const hist = await interactions.listForContact(db, c.id);
      return { ...c, interactions: hist };
    }
    case "log_interaction": {
      const id = String(args?.contactId ?? "");
      const c = await store.get(db, id);
      if (!c) throw new Error(`no contact with id ${id}`);
      const channel = CHANNELS.includes(args?.channel) ? args.channel : "note";
      const it = await interactions.add(db, id, { channel, summary: String(args?.summary ?? "") });
      if (args?.followUpAt) {
        await store.update(db, id, {
          followUpAt: args.followUpAt,
          followUpNote: args.followUpNote ?? c.followUpNote ?? undefined,
        });
      }
      return { logged: it, followUpAt: args?.followUpAt ?? c.followUpAt };
    }
    case "add_contact": {
      const c = await store.create(db, {
        name: String(args?.name ?? ""),
        emails: args?.emails ?? [],
        phones: args?.phones ?? [],
        company: args?.company,
        title: args?.title,
        tags: args?.tags ?? [],
        notes: args?.notes,
        linkedin: args?.linkedin,
        addedBy: "mcp",
      });
      return c;
    }
    case "update_contact": {
      const id = String(args?.id ?? "");
      const allowed = [
        "name", "emails", "phones", "company", "title", "tags",
        "notes", "linkedin", "followUpAt", "followUpNote",
      ];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (k in (args ?? {})) patch[k] = args[k];
      if (!Object.keys(patch).length) throw new Error("nothing to update — pass at least one field");
      const c = await store.update(db, id, patch as ContactPatchT);
      if (!c) throw new Error(`no contact with id ${id}`);
      return c;
    }
    case "who_to_contact_today": {
      const today = new Date().toISOString().slice(0, 10);
      const all = (await store.list(db, { limit: 100_000 }))
        .filter((c) => !(c.tags ?? []).includes("do-not-contact"));
      const fu = (c: Contact) => (c.followUpAt ?? "").slice(0, 10);
      const stage = (c: Contact) =>
        (c.tags ?? []).find((t) => t.startsWith("stage:"))?.slice(6);
      const overdue = all.filter((c) => fu(c) && fu(c) < today);
      const due = all.filter((c) => fu(c) === today);
      const adrift = all.filter((c) => !fu(c) && PIPELINE_STAGES.includes(stage(c) ?? ""));
      return {
        date: today,
        overdue: overdue.map(card),
        dueToday: due.map(card),
        pipelineNoNextStep: adrift.map(card),
      };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

mcp.post("/", requireApiKey, async (c) => {
  const msg = await c.req.json().catch(() => null);
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "expected a single JSON-RPC message" } }, 400);
  }
  const { id, method, params } = msg as { id?: unknown; method?: string; params?: any };

  // Notifications carry no id and expect no body.
  if (id === undefined || id === null) return c.body(null, 202);

  const reply = (result: unknown) => c.json({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => c.json({ jsonrpc: "2.0", id, error: { code, message } });

  try {
    switch (method) {
      case "initialize":
        return reply({
          protocolVersion: PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "agentic-contacts", version: "1.0.0" },
        });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: TOOLS });
      case "tools/call": {
        try {
          const data = await callTool(c.env, String(params?.name ?? ""), params?.arguments ?? {});
          return reply({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
        } catch (e) {
          // Tool-level failures are results, not protocol errors — the model
          // should read them and adjust, not crash the session.
          return reply({ content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true });
        }
      }
      default:
        return fail(-32601, `method not found: ${method}`);
    }
  } catch (e) {
    return fail(-32603, (e as Error).message);
  }
});

// The stateless form has nothing to stream and nothing to delete.
mcp.get("/", (c) => c.json({ error: "POST JSON-RPC messages here; this server does not stream" }, 405));
mcp.delete("/", (c) => c.body(null, 405));
