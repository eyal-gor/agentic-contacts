#!/usr/bin/env node
import { Command } from "commander";

// Thin CLI client over the REST API — the CLI never touches the store
// directly, it just speaks HTTP to the running server.
const BASE = process.env.CONTACTS_API_URL ?? "http://localhost:8787";
const API_KEY = process.env.API_KEY;

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    console.error(`Error ${res.status}:`, data);
    process.exit(1);
  }
  return data;
}

// Sales pipeline stages, in funnel order. Stored on a contact as a
// namespaced tag `stage:<name>` so it coexists with freeform tags and
// `icp:<segment>` without a schema change.
const STAGES = ["lead", "contacted", "call", "trial", "proposal", "won", "lost"] as const;

const program = new Command();
program.name("contacts").description("CLI for the Agentic Contacts API");

program
  .command("list")
  .option("-q, --query <q>", "search text")
  .option("-t, --tag <tag>", "filter by tag")
  .option("-s, --sort <sort>", "recent | stale (by last contacted)")
  .action(async (opts) => {
    const params = new URLSearchParams();
    if (opts.query) params.set("q", opts.query);
    if (opts.tag) params.set("tag", opts.tag);
    if (opts.sort) params.set("sort", opts.sort);
    const data = await api(`/contacts?${params}`);
    console.table(
      data.contacts.map((c: any) => ({
        id: c.id,
        name: c.name,
        company: c.company ?? "",
        last: c.lastInteraction
          ? `${c.lastInteraction.occurredAt.slice(0, 10)} (${c.lastInteraction.channel})`
          : "—",
        next: c.followUpAt ? c.followUpAt.slice(0, 10) : "—",
      })),
    );
  });

program
  .command("add")
  .requiredOption("-n, --name <name>", "full name")
  .option("-e, --email <email...>", "email(s)")
  .option("-p, --phone <phone...>", "phone(s)")
  .option("-c, --company <company>", "company")
  .option("--title <title>", "job title")
  .option("-t, --tag <tag...>", "tag(s)")
  .option("--notes <notes>", "free-text notes")
  .option("--linkedin <url>", "LinkedIn profile URL")
  .action(async (opts) => {
    const created = await api("/contacts", {
      method: "POST",
      body: JSON.stringify({
        name: opts.name,
        emails: opts.email ?? [],
        phones: opts.phone ?? [],
        company: opts.company,
        title: opts.title,
        tags: opts.tag ?? [],
        notes: opts.notes,
        linkedin: opts.linkedin,
      }),
    });
    console.log("Created:", created.id);
  });

program.command("get <id>").action(async (id) => {
  console.log(JSON.stringify(await api(`/contacts/${id}`), null, 2));
});

program
  .command("update <id>")
  .option("-n, --name <name>", "full name")
  .option("-c, --company <company>", "company")
  .option("--title <title>", "job title")
  .option("--notes <notes>", "free-text notes")
  .option("--linkedin <url>", "LinkedIn profile URL")
  .option("-t, --tag <tag...>", "replace all tags")
  .option("--stage <stage>", `set pipeline stage (${STAGES.join("|")})`)
  .option("--icp <icp>", "set ICP segment (e.g. dev, biz)")
  .action(async (id, opts) => {
    const patch: Record<string, unknown> = {};
    for (const k of ["name", "company", "title", "notes", "linkedin"] as const) {
      if (opts[k] != null) patch[k] = opts[k];
    }
    // Tag handling: --tag replaces wholesale; --stage / --icp swap only their
    // namespaced tag (stage:* / icp:*) and preserve every other tag. When no
    // --tag is given we read the current tags first so the swap is non-destructive.
    if (opts.tag || opts.stage || opts.icp) {
      let tags: string[] = opts.tag ?? (await api(`/contacts/${id}`)).tags ?? [];
      if (opts.stage) {
        if (!(STAGES as readonly string[]).includes(opts.stage)) {
          console.error(`Unknown stage "${opts.stage}". Use one of: ${STAGES.join(", ")}`);
          process.exit(1);
        }
        tags = tags.filter((t) => !t.startsWith("stage:")).concat(`stage:${opts.stage}`);
      }
      if (opts.icp) {
        tags = tags.filter((t) => !t.startsWith("icp:")).concat(`icp:${opts.icp}`);
      }
      patch.tags = tags;
    }
    const updated = await api(`/contacts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    const tagStr = updated.tags?.length ? ` · ${updated.tags.join(", ")}` : "";
    console.log("Updated:", updated.id + tagStr);
  });

program.command("rm <id>").action(async (id) => {
  await api(`/contacts/${id}`, { method: "DELETE" });
  console.log("Deleted:", id);
});

program
  .command("log <id>")
  .description("log a conversation/interaction with a contact")
  .requiredOption("-s, --summary <summary>", "what happened")
  .option("-c, --channel <channel>", "call|email|meeting|message|note|other", "note")
  .option("--at <iso>", "when it happened (ISO timestamp); defaults to now")
  .option("--next <date>", "set the next-talk reminder while logging")
  .action(async (id, opts) => {
    const created = await api(`/contacts/${id}/interactions`, {
      method: "POST",
      body: JSON.stringify({ summary: opts.summary, channel: opts.channel, occurredAt: opts.at }),
    });
    console.log(`Logged ${created.channel} · ${created.occurredAt.slice(0, 10)} · ${created.id}`);
    if (opts.next) {
      await api(`/contacts/${id}`, { method: "PATCH", body: JSON.stringify({ followUpAt: opts.next }) });
      console.log(`Next talk set for ${opts.next}`);
    }
  });

program
  .command("remind <id>")
  .description("set or clear the next-talk reminder for a contact")
  .option("--at <date>", "when to next reach out (ISO date)")
  .option("--note <note>", "what to talk about")
  .option("--clear", "clear the reminder")
  .action(async (id, opts) => {
    const patch = opts.clear
      ? { followUpAt: null, followUpNote: null }
      : { followUpAt: opts.at, followUpNote: opts.note };
    const updated = await api(`/contacts/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    console.log(
      opts.clear
        ? `Reminder cleared for ${updated.name}`
        : `Next talk with ${updated.name}: ${updated.followUpAt?.slice(0, 10) ?? "—"}${updated.followUpNote ? ` · ${updated.followUpNote}` : ""}`,
    );
  });

program
  .command("due")
  .description("show contacts with a reminder due")
  .option("-w, --window <window>", "overdue | today | week | all", "today")
  .action(async (opts) => {
    const data = await api(`/contacts?due=${encodeURIComponent(opts.window)}`);
    if (!data.contacts.length) return console.log(`Nothing due (${opts.window}).`);
    console.table(
      data.contacts.map((c: any) => ({
        name: c.name,
        due: c.followUpAt.slice(0, 10),
        about: c.followUpNote ?? "",
      })),
    );
  });

program
  .command("history <id>")
  .description("show conversation history with a contact")
  .action(async (id) => {
    const data = await api(`/contacts/${id}/interactions`);
    if (!data.interactions.length) return console.log("No interactions yet.");
    console.table(
      data.interactions.map((i: any) => ({
        when: i.occurredAt.slice(0, 10),
        channel: i.channel,
        summary: i.summary,
      })),
    );
  });

program
  .command("pipeline")
  .description("show contacts grouped by sales pipeline stage")
  .option("--icp <icp>", "only this ICP segment (e.g. dev, biz)")
  .option("--all", "include non-sales contacts (advisors, recruiting, etc.)")
  .action(async (opts) => {
    const data = await api(`/contacts?limit=1000`);
    let contacts = data.contacts as any[];
    // The pipeline is about sales. Relationships explicitly tagged as
    // non-sales (advisors, recruiting, do-not-contact) never appear here,
    // so the untriaged bucket stays meaningful instead of noisy. Pass --all
    // to override and see everyone.
    const NON_SALES = ["advice", "recruiting", "do-not-contact"];
    if (!opts.all) contacts = contacts.filter((c) => !(c.tags ?? []).some((t: string) => NON_SALES.includes(t)));
    if (opts.icp) contacts = contacts.filter((c) => (c.tags ?? []).includes(`icp:${opts.icp}`));

    const stageOf = (c: any): string =>
      (c.tags ?? []).find((t: string) => t.startsWith("stage:"))?.slice(6) ?? "(unstaged)";

    // Known stages in funnel order, then any custom stages found, then unstaged.
    const present = new Set(contacts.map(stageOf));
    const extras = [...present].filter((s) => s !== "(unstaged)" && !(STAGES as readonly string[]).includes(s));
    const order = [...STAGES, ...extras, "(unstaged)"];

    for (const s of order) {
      const rows = contacts.filter((c) => stageOf(c) === s);
      if (!rows.length) continue;
      console.log(`\n${s.toUpperCase()}  (${rows.length})`);
      for (const c of rows) {
        const co = c.company ? ` (${c.company})` : "";
        const next = c.followUpAt ? ` · next ${c.followUpAt.slice(0, 10)}` : "";
        console.log(`  • ${c.name}${co}${next}`);
      }
    }
    console.log(`\nTotal: ${contacts.length}${opts.icp ? ` · icp:${opts.icp}` : ""}`);
  });

program.parseAsync();
