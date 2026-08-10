import * as store from "./store.js";
import * as interactions from "./interactions.js";

/**
 * Networking activity, counted.
 *
 * `/events` is a feed for the UI to draw; this is the same history reduced to
 * numbers, so a business system can hold "how much outreach actually happened"
 * as a metric with a target beside it instead of a page someone has to read.
 *
 * Only the real network counts. The imported segments, the phone-number-only
 * rows and Eyal's own card would otherwise make a quiet week look busy.
 */
export type Activity = Awaited<ReturnType<typeof computeActivity>>;

export async function computeActivity(db: D1Database, days: number) {
  const [all, inter] = await Promise.all([
    store.list(db, { limit: 100_000 }),
    interactions.all(db),
  ]);

  const isNetwork = (ct: (typeof all)[number]) =>
    !(ct.tags || []).some((t) => t.startsWith("segment:") || t === "unidentified" || t === "self");
  const network = all.filter(isNetwork);
  const inNetwork = new Set(network.map((ct) => ct.id));
  const reached = inter.filter((i) => inNetwork.has(i.contactId));
  const everContacted = new Set(reached.map((i) => i.contactId)).size;

  const today = new Date().toISOString().slice(0, 10);
  const day = (iso: string) => (iso || "").slice(0, 10);

  // one row per day in the window, zero-filled so a gap reads as a gap
  const series: Array<{ date: string; added: number; reachedOut: number; people: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const touched = reached.filter((x) => day(x.occurredAt) === d);
    series.push({
      date: d,
      added: network.filter((ct) => day(ct.createdAt) === d).length,
      reachedOut: touched.length,
      people: new Set(touched.map((x) => x.contactId)).size,
    });
  }
  const last = series[series.length - 1];
  const sum = (k: "added" | "reachedOut") => series.reduce((n, r) => n + r[k], 0);

  return {
    generatedAt: new Date().toISOString(),
    window: { days, since: series[0].date, until: today },
    today: {
      added: last.added,
      reachedOut: last.reachedOut,
      people: last.people,
      followUpsDue: network.filter((ct) => ct.followUpAt && day(ct.followUpAt) === today).length,
    },
    totals: {
      contacts: network.length,
      excluded: all.length - network.length,
      everContacted,
      neverContacted: network.length - everContacted,
      followUpsOverdue: network.filter((ct) => ct.followUpAt && day(ct.followUpAt) < today).length,
      addedInWindow: sum("added"),
      reachedOutInWindow: sum("reachedOut"),
    },
    series,
  };
}

/**
 * Push the day's numbers onto a Kompany machine.
 *
 * Kompany maps the business as machines on a canvas; every one of them was
 * carrying a null metric, which is a map with no instruments. This makes the
 * outreach machine report what actually happened, on its own, every night.
 *
 * Failures are logged and swallowed: a metrics push is not worth failing a
 * cron over, and the next run carries the same standing totals anyway.
 */
export async function pushToKompany(env: {
  KOMPANY_API_KEY?: string;
  KOMPANY_PROSPECTOR_MACHINE_ID?: string;
  KOMPANY_OUTREACH_MACHINE_ID?: string;
  KOMPANY_URL?: string;
}, a: Activity): Promise<{ pushed: number; failed: number }> {
  const key = env.KOMPANY_API_KEY;
  if (!key) return { pushed: 0, failed: 0 };
  const base = env.KOMPANY_URL || "https://kompany.dev";

  // Finding people and talking to them are two different machines on the
  // canvas, and the numbers belong to whichever one actually did the work —
  // all four on one tile would read as one process that isn't one.
  const routed: Array<[string | undefined, { metric_name: string; value: number; label: string }]> = [
    [env.KOMPANY_PROSPECTOR_MACHINE_ID, { metric_name: "new_contacts", value: a.today.added, label: "people added today" }],
    [env.KOMPANY_PROSPECTOR_MACHINE_ID, { metric_name: "never_contacted", value: a.totals.neverContacted, label: "found, never talked to" }],
    [env.KOMPANY_OUTREACH_MACHINE_ID, { metric_name: "outreach_sent", value: a.today.reachedOut, label: "conversations logged today" }],
    [env.KOMPANY_OUTREACH_MACHINE_ID, { metric_name: "followups_overdue", value: a.totals.followUpsOverdue, label: "follow-ups past due" }],
  ];

  let pushed = 0, failed = 0;
  for (const [machine, m] of routed) {
    if (!machine) continue;
    try {
      const r = await fetch(`${base}/api/machines/${machine}/metrics`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...m, period: "daily" }),
      });
      r.ok ? pushed++ : (failed++, console.log(`kompany ${m.metric_name}: ${r.status} ${await r.text()}`));
    } catch (e) {
      failed++;
      console.log(`kompany ${m.metric_name} threw:`, e);
    }
  }
  return { pushed, failed };
}
