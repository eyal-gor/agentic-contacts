// Talks to the Agentic Contacts API for the LinkedIn content script.
//
// The content script never sees the API key: it sends messages here, and
// this worker makes the calls (host permissions, so no CORS). It keeps
// the whole contact list in memory, indexed by LinkedIn profile, so pages
// can show "already in your contacts" without a call per name.

importScripts("icps.js"); // self.ICPS: who you're looking for

const DEFAULT_API = "https://contacts.autobirds.com";
const APP_URL = "https://app.contacts.autobirds.com/";
const CACHE_MS = 5 * 60 * 1000;

let cache = { at: 0, contacts: [], bySlug: new Map(), nudges: new Map() };

// Outreach you did (asked, messaged, emailed, called, followed up), not
// their messages or bookkeeping like stage changes.
function isNudge(i) {
  const s = String(i.summary || "");
  if (/^(They |Accepted the LinkedIn|Stage →|Reason for the LinkedIn)/.test(s)) return false;
  return ["message", "email", "call", "meeting"].includes(i.channel) || /^Followed up/.test(s);
}
async function nudgesOf(id) {
  if (cache.nudges.has(id)) return cache.nudges.get(id);
  const { interactions = [] } = await api("GET", `/contacts/${id}/interactions`).catch(() => ({}));
  const mine = interactions.filter(isNudge);
  const v = { count: mine.length, last: mine[0]?.occurredAt?.slice(0, 10) || null, theirs: interactions.filter((i) => /^They /.test(i.summary || "")).length };
  cache.nudges.set(id, v);
  return v;
}
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (k < items.length) { const i = k++; out[i] = await fn(items[i]); }
  }));
  return out;
}

async function config() {
  const { apiUrl, apiKey } = await chrome.storage.local.get(["apiUrl", "apiKey"]);
  return { apiUrl: (apiUrl || DEFAULT_API).replace(/\/+$/, ""), apiKey: apiKey || "" };
}

async function api(method, path, body) {
  const { apiUrl, apiKey } = await config();
  const res = await fetch(apiUrl + path, {
    method,
    // The key when one is set; otherwise the browser's sign-in cookie.
    credentials: "include",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Not signed in. Open the extension options and paste your API key.");
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

// Same rule as the server's normLinkedin: "https://www.linkedin.com/in/Ada-L/?x" → "in/ada-l".
const hashStr = (t) => { let h = 0; for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };

function slugOf(url) {
  const m = String(url || "").toLowerCase().match(/linkedin\.com\/(in|pub)\/([^/?#]+)/);
  if (!m) return null;
  let s = m[2];
  try { s = decodeURIComponent(s); } catch {}
  return `${m[1]}/${s}`;
}

async function contacts(force) {
  if (!force && Date.now() - cache.at < CACHE_MS && cache.contacts.length) return cache;
  const { contacts: list } = await api("GET", "/contacts?limit=100000");
  const bySlug = new Map();
  for (const c of list) {
    const s = slugOf(c.linkedin);
    if (s) bySlug.set(s, c);
  }
  cache = { at: Date.now(), contacts: list, bySlug, nudges: new Map() };
  return cache;
}

// "Why connect (2026-11-10): met at X" lines, newest first.
function reasonsOf(notes) {
  return String(notes || "")
    .split("\n")
    .map((l) => l.match(/^Why connect(?: \(([^)]+)\))?:\s*(.+)$/))
    .filter(Boolean)
    .map((m) => ({ date: m[1] || "", text: m[2] }))
    .reverse();
}

// "Say when they accept (2026-11-11): …" — newest last in the notes.
const sayOf = (notes) => (String(notes || "").split("\n").map((l) => l.match(/^Say when they accept(?: \([^)]*\))?:\s*(.+)$/)).filter(Boolean).at(-1) || [])[1] || "";
const icpsOf = (tags) => (self.ICPS || []).filter((i) => (tags || []).includes(`icp:${i.id}`)).map((i) => ({ id: i.id, short: i.short, person: i.person }));
const firstLine = (notes) => String(notes || "").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 160) || "";

function summary(c) {
  return {
    notes: c.notes || "",
    stage: (c.tags || []).find((t) => t.startsWith("stage:"))?.slice(6) || "",
    connected: (c.tags || []).includes("linkedin:connected"),
    replied: (c.tags || []).includes("linkedin:replied"),
    campaigns: (c.tags || []).filter((t) => t.startsWith("campaign:")).map((t) => t.slice(9)),
    id: c.id,
    name: c.name,
    title: c.title || "",
    company: c.company || "",
    tags: c.tags || [],
    reasons: reasonsOf(c.notes),
    sayLater: sayOf(c.notes),
    offers: (c.tags || []).filter((t) => t.startsWith("offer:")).map((t) => t.slice(6)),
    icps: icpsOf(c.tags),
    requested: (c.tags || []).includes("linkedin:requested"),
    followUpAt: c.followUpAt || null,
    followUpNote: c.followUpNote || null,
    lastInteraction: c.lastInteraction || null,
    appUrl: `${APP_URL}#c/${c.id}`,
  };
}

// "Cerver AI agencies" → "campaign:cerver-ai-agencies"
function campaignTag(name) {
  const s = String(name || "").trim().toLowerCase().replace(/^campaign:/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s ? `campaign:${s}` : "";
}
const shownTags = (tags) => (tags || []).filter((t) => !/^(list:|circle:|linkedin:)/.test(t));

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// Add a person, or add to the one already stored under that LinkedIn URL.
// The server's upsert unions tags and appends notes, so nothing is lost.
async function save(p) {
  const { bySlug } = await contacts();
  const existing = bySlug.get(slugOf(p.url));
  // kind: how this outreach happened. "requested" = I asked to connect,
  // "message" = I messaged them, "inbound" = they asked me.
  const kind = p.kind || (p.requested ? "requested" : null);
  const campaign = campaignTag(p.campaign);
  const tags = [...(p.tags || [])];
  if (campaign) tags.push(campaign);
  if (p.icp && !tags.includes(`icp:${p.icp}`)) tags.push(`icp:${p.icp}`);
  let offer = null;
  if (p.offer) {
    offer = await api("POST", `/offers/${encodeURIComponent(p.offer)}/used`).catch(() => null);
    tags.push(`offer:${p.offer}`);
  }
  const notes = [];
  const stamp = [today(), campaign ? campaign.slice(9) : ""].filter(Boolean).join(" · ");
  if (p.reason) notes.push(`Why connect (${stamp}): ${p.reason}`);
  if (p.note) notes.push(p.note);
  if (offer) notes.push(`Offer (${today()}): ${offer.name}${offer.pitch ? " — " + offer.pitch : ""}`);
  if (p.sayLater) notes.push(`Say when they accept (${today()}): ${p.sayLater}`);
  if (kind === "requested") tags.push("linkedin:requested");
  if (kind === "inbound") tags.push("linkedin:inbound");
  const body = {
    name: existing ? existing.name : p.name,
    linkedin: p.url,
    tags,
    ...(notes.length ? { notes: notes.join("\n") } : {}),
    ...(!existing && p.title ? { title: p.title } : {}),
    ...(!existing && p.company ? { company: p.company } : {}),
    ...(!existing ? { addedBy: "Eyal (LinkedIn extension)" } : {}),
  };
  if (p.remind && !(kind === "requested" && existing?.followUpAt)) {
    body.followUpAt = inDays(7);
    body.followUpNote = kind === "requested"
      ? `Did ${body.name.split(" ")[0]} accept on LinkedIn?${p.reason ? " Why: " + p.reason : ""}`
      : `Follow up with ${body.name.split(" ")[0]}${p.reason ? ": " + p.reason : ""}`;
  }
  const saved = await api("POST", "/contacts?upsert=1", body);
  const repeat = kind === "requested" && (existing?.tags || []).includes("linkedin:requested");
  const what = repeat
    ? (p.reason || campaign ? "Reason for the LinkedIn request" : null)
    : { requested: "Asked to connect on LinkedIn", message: "Messaged on LinkedIn", inbound: "They asked to connect on LinkedIn" }[kind];
  if (what) {
    await api("POST", `/contacts/${saved.id}/interactions`, {
      channel: "message",
      summary: `${what}${campaign ? ` (${campaign.slice(9)})` : ""}${p.reason ? ". Why: " + p.reason : ""}`,
    });
  } else if (p.note) {
    await api("POST", `/contacts/${saved.id}/interactions`, { channel: "note", summary: p.note });
  }
  cache.at = 0;
  return lookup(p.url);
}

// "Timothy Kassis, PhD" and "Timothy Kassis" are the same name.
const normName = (n) => String(n || "").toLowerCase().replace(/,.*$|\(.*?\)|\b(phd|dr|mr|ms|mrs)\b\.?/g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
async function lookup(url, name) {
  const { bySlug, contacts: list } = await contacts();
  const c = bySlug.get(slugOf(url));
  if (!c) {
    // Saved without a LinkedIn link (e.g. found by research)? Match the name.
    const want = normName(name);
    if (want.length < 2) return { found: false };
    const key = want[0] + " " + want.at(-1);
    const hits = list.filter((x) => !slugOf(x.linkedin) && (() => { const n = normName(x.name); return n.length >= 2 && n[0] + " " + n.at(-1) === key; })());
    if (hits.length !== 1) return { found: false };
    const h = hits[0];
    return { found: false, candidate: { id: h.id, name: h.name, title: h.title || "", company: h.company || "", why: reasonsOf(h.notes)[0]?.text || firstLine(h.notes), evidence: (String(h.notes || "").match(/^Evidence:\s*(.+)$/m) || [])[1] || "", suggested: (h.tags || []).includes("suggested"), icp: icpsOf(h.tags)[0]?.short || "" } };
  }
  const fresh = await api("GET", `/contacts/${c.id}`);
  const { interactions } = await api("GET", `/contacts/${c.id}/interactions`).catch(() => ({ interactions: [] }));
  return { found: true, contact: summary(fresh), interactions: (interactions || []).slice(0, 5) };
}

// ── Drafting with Claude ──────────────────────────────────────────────
// The Anthropic key lives in extension storage (set on the options page)
// and is sent only to api.anthropic.com.
const NOTE_LIMIT = 300; // LinkedIn's cap on a connection note

// One call to Claude. With a schema, the answer is JSON matching it.
async function claude({ system, user, schema, maxTokens = 4000 }) {
  const { anthropicKey } = await chrome.storage.local.get("anthropicKey");
  if (!anthropicKey) throw new Error("Add an Anthropic API key in the extension settings to use Claude.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2026-10-21",
      "anthropic-dangerous-direct-browser-access": "true",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-5-5",
      max_tokens: maxTokens,
      output_config: { effort: "low", ...(schema ? { format: { type: "json_schema", schema } } : {}) },
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude: ${data.error?.message || "HTTP " + res.status}`);
  if (data.stop_reason === "refusal") throw new Error("Claude declined this one.");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return schema ? JSON.parse(text) : text;
}

// ── Saved posts ────────────────────────────────────────────────────────
// Kept in this browser (chrome.storage). Claude reviews each one against
// your ICPs: who wrote it, does it fit, what to say.
const POST_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    icp: { type: "string" },
    fit: { type: "integer" },
    why: { type: "string" },
    comment: { type: "string" },
    message: { type: "string" },
  },
  required: ["summary", "icp", "fit", "why", "comment", "message"],
  additionalProperties: false,
};
async function getPosts() { return (await chrome.storage.local.get("posts")).posts || []; }
async function setPosts(posts) { await chrome.storage.local.set({ posts }); }
async function reviewPost(id) {
  const posts = await getPosts();
  const p = posts.find((x) => x.id === id);
  if (!p) throw new Error("Post not found");
  const { aboutMe = "" } = await chrome.storage.local.get("aboutMe");
  const icps = self.ICPS.map((i) => `- ${i.id}: ${i.name}. ${i.person} Not them: ${i.notThem}`).join("\n");
  const system = [
    "You review LinkedIn posts I saved, to decide if the author is worth reaching out to and how.",
    aboutMe && `About me: ${aboutMe}`,
    `The people I'm looking for (ICPs):\n${icps}`,
    "Answer in plain, short sentences. Never invent facts about the author beyond the post.",
    "summary: one sentence on what the post says.",
    "icp: the id of the ICP the author most likely fits, or \"none\".",
    "fit: 0-10, how well the author fits that ICP, judged only from the post and their headline.",
    "why: one or two sentences on why this post matters to me (or why it doesn't).",
    "comment: a public comment I could leave, 1-2 sentences, adds something specific, no flattery, no pitch, no links.",
    "message: a first LinkedIn message (or connection note, max 280 characters) that refers to this post, with a tiny ask. Empty string if fit is below 5.",
  ].filter(Boolean).join("\n\n");
  const user = `Author: ${p.author.name}${p.author.headline ? " · " + p.author.headline : ""}\nProfile: ${p.author.url || "unknown"}\n\nPost:\n${p.text.slice(0, 6000)}`;
  const review = await claude({ system, user, schema: POST_SCHEMA });
  review.at = new Date().toISOString();
  const fresh = await getPosts();
  const q = fresh.find((x) => x.id === id);
  if (q) { q.review = review; await setPosts(fresh); }
  return q;
}

async function draft({ kind, person = {}, reason, campaign, notes, thread, offer: offerId }) {
  const { aboutMe = "", pitches = {} } = await chrome.storage.local.get(["aboutMe", "pitches"]);
  const offer = offerId ? await api("GET", `/offers/${encodeURIComponent(offerId)}`).catch(() => null) : null;
  const camp = campaignTag(campaign).slice(9);
  const pitch = camp ? pitches[camp] || "" : "";
  const what = {
    note: `a LinkedIn connection note, at most ${NOTE_LIMIT - 20} characters`,
    message: "a first LinkedIn message to someone who just accepted my connection request, 2-4 short lines",
    reply: "my reply in this LinkedIn conversation, 1-4 short lines",
  }[kind] || "a short LinkedIn message";
  const system = [
    `You write ${what} for me to send. Output only the text to send: no greeting line on its own, no sign-off, no quotes, no options.`,
    "Rules: the first line is tied to the specific reason I am reaching out to this person. One sentence on the problem, in their words. A tiny ask (a quick question or a 15-minute call), never a pitch. No links. No flattery, no buzzwords, no exclamation marks. Short, plain, concrete. Write like a founder typing quickly, not like marketing.",
    "Never invent facts about them or me. If you don't know something, leave it out.",
    aboutMe && `About me: ${aboutMe}`,
    pitch && `What this campaign (${camp}) is about: ${pitch}`,
    offer && `What I'm offering them: ${offer.name}${offer.pitch ? ". " + offer.pitch : ""}`,
  ].filter(Boolean).join("\n\n");
  const user = [
    `Them: ${[person.name, person.title, person.company, person.location].filter(Boolean).join(" · ")}`,
    reason && `Why I want to reach them: ${reason}`,
    camp && `Campaign: ${camp}`,
    notes && `My notes on them:\n${String(notes).slice(0, 1500)}`,
    thread && `The conversation so far (oldest first):\n${String(thread).slice(-3000)}`,
  ].filter(Boolean).join("\n");
  let text = (await claude({ system, user })).replace(/^"|"$/g, "");
  if (kind === "note" && text.length > NOTE_LIMIT) text = text.slice(0, NOTE_LIMIT - 1).replace(/\s+\S*$/, "") + "…";
  return { text, limit: kind === "note" ? NOTE_LIMIT : null };
}

const handlers = {
  async index() {
    const { bySlug } = await contacts();
    const out = {};
    for (const [slug, c] of bySlug) {
      out[slug] = {
        id: c.id,
        name: c.name,
        why: reasonsOf(c.notes)[0]?.text || firstLine(c.notes),
        reasonSaved: reasonsOf(c.notes).length > 0,
        requested: (c.tags || []).includes("linkedin:requested"),
        connected: (c.tags || []).includes("linkedin:connected"),
        replied: (c.tags || []).includes("linkedin:replied"),
        tags: shownTags(c.tags),
      };
    }
    return out;
  },
  lookup: ({ url, name }) => lookup(url, name),
  // "This is them": store their LinkedIn on a contact saved without one.
  async linkProfile({ id, url }) {
    await api("PATCH", `/contacts/${id}`, { linkedin: url });
    cache.at = 0;
    return lookup(url);
  },
  // Campaigns in use, most-used first: [{ name, count }].
  async campaigns() {
    const { contacts: list } = await contacts();
    const n = new Map();
    for (const c of list) for (const t of c.tags || []) if (t.startsWith("campaign:")) n.set(t.slice(9), (n.get(t.slice(9)) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  },
  save: (p) => save(p),
  async note({ id, text, url, channel }) {
    await api("POST", `/contacts/${id}/interactions`, { channel: channel || "note", summary: text });
    cache.at = 0;
    return lookup(url);
  },
  // Next-talk reminder: days from today, or null to clear it.
  async followUp({ id, days, note, url }) {
    await api("PATCH", `/contacts/${id}`, days == null
      ? { followUpAt: null, followUpNote: null }
      : { followUpAt: inDays(days), followUpNote: note || null });
    cache.at = 0;
    return lookup(url);
  },
  // Follow-ups due today or earlier, oldest first.
  async due() {
    const { contacts: list } = await contacts();
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const due = list
      .filter((c) => c.followUpAt && Date.parse(c.followUpAt) <= end.getTime())
      .sort((a, b) => Date.parse(a.followUpAt) - Date.parse(b.followUpAt));
    const nudges = await mapLimit(due, 6, (c) => nudgesOf(c.id));
    return due.map((c, i) => ({
        nudges: nudges[i],
        why: reasonsOf(c.notes)[0]?.text || firstLine(c.notes),
        whySaved: reasonsOf(c.notes).length > 0,
        campaigns: (c.tags || []).filter((t) => t.startsWith("campaign:")).map((t) => t.slice(9)),
        replied: (c.tags || []).includes("linkedin:replied"),
        requested: (c.tags || []).includes("linkedin:requested"),
        id: c.id,
        name: c.name,
        note: c.followUpNote || "",
        at: c.followUpAt.slice(0, 10),
        linkedin: slugOf(c.linkedin) ? `https://www.linkedin.com/${slugOf(c.linkedin)}/` : "",
        appUrl: `${APP_URL}#c/${c.id}`,
      }));
  },
  // Done: clear the reminder and log that you followed up.
  async done({ id, url }) {
    await api("PATCH", `/contacts/${id}`, { followUpAt: null, followUpNote: null });
    await api("POST", `/contacts/${id}/interactions`, { channel: "note", summary: "Followed up (from LinkedIn)" });
    cache.at = 0;
    return url ? lookup(url) : { ok: true };
  },
  async snooze({ id, days, url }) {
    await api("PATCH", `/contacts/${id}`, { followUpAt: inDays(days || 3) });
    cache.at = 0;
    return url ? lookup(url) : { ok: true };
  },
  // LinkedIn's Send on a connection request: record it (and the note typed
  // in LinkedIn's "Add a note" box) even if the panel was never used.
  async connectSent({ url, name, title, note }) {
    const { bySlug } = await contacts();
    const existing = bySlug.get(slugOf(url));
    const already = existing && (existing.tags || []).includes("linkedin:requested");
    if (!already) {
      await save({ url, name, title, kind: "requested", remind: true });
    }
    if (note) {
      const { bySlug: fresh } = await contacts(true);
      const c = fresh.get(slugOf(url));
      if (c) await api("POST", `/contacts/${c.id}/interactions`, { channel: "message", summary: `Connection note sent: ${note}` });
    }
    cache.at = 0;
    return lookup(url);
  },
  // They accepted: swap the tag, log it, and drop the "did they accept?" reminder.
  async accepted({ id, url }) {
    const c = await api("GET", `/contacts/${id}`);
    const tags = (c.tags || []).filter((t) => t !== "linkedin:requested");
    if (!tags.includes("linkedin:connected")) tags.push("linkedin:connected");
    const patch = { tags };
    if (/^Did .* accept on LinkedIn\?/.test(c.followUpNote || "")) Object.assign(patch, { followUpAt: null, followUpNote: null });
    await api("PATCH", `/contacts/${id}`, patch);
    await api("POST", `/contacts/${id}/interactions`, { channel: "note", summary: "Accepted the LinkedIn connection request" });
    cache.at = 0;
    // Remind you why, and what you wanted to say: a Chrome notification, and
    // the panel shows it next time it opens.
    const plan = { id, name: c.name, url: url || c.linkedin || "", why: reasonsOf(c.notes)[0]?.text || "", say: sayOf(c.notes), icp: icpsOf(c.tags)[0]?.short || "", at: new Date().toISOString() };
    const { acceptedQueue = [] } = await chrome.storage.local.get("acceptedQueue");
    await chrome.storage.local.set({ acceptedQueue: [plan, ...acceptedQueue.filter((x) => x.id !== id)].slice(0, 20) });
    try {
      chrome.notifications.create("accepted:" + id, {
        type: "basic", iconUrl: "icon-128.png", priority: 2, requireInteraction: true,
        title: `${c.name} accepted your request`,
        message: plan.say ? `You wanted to say: ${plan.say}` : plan.why ? `Why you reached out: ${plan.why}` : "Send a first message.",
        contextMessage: [plan.icp, plan.say && plan.why ? "Why: " + plan.why : ""].filter(Boolean).join(" · ").slice(0, 120),
      });
    } catch {}
    return lookup(url);
  },
  // Tags in use (not campaigns, lists or LinkedIn status), most-used first.
  // ── Offers: what you're selling someone. Most recently used first. ──
  // Stored in the Contacts API, so the CLI edits the same list.
  async offers() {
    const { offers = [] } = await api("GET", "/offers");
    return offers;
  },
  async saveOffer({ name, pitch, icp }) {
    if (!String(name || "").trim()) throw new Error("Give the offer a name.");
    return api("POST", "/offers", { name: name.trim(), pitch: String(pitch || "").trim(), icp: icp || null });
  },
  async updateOffer({ id, name, pitch, icp }) {
    return api("PATCH", `/offers/${encodeURIComponent(id)}`, { name, pitch, icp: icp || null });
  },
  async deleteOffer({ id }) {
    await api("DELETE", `/offers/${encodeURIComponent(id)}`);
    return { ok: true };
  },
  async ackAccepted({ id }) {
    const { acceptedQueue = [] } = await chrome.storage.local.get("acceptedQueue");
    await chrome.storage.local.set({ acceptedQueue: acceptedQueue.filter((x) => x.id !== id) });
    return { ok: true };
  },
  async tags() {
    const { contacts: list } = await contacts();
    const n = new Map();
    for (const c of list) for (const t of c.tags || []) if (!/^(list:|circle:|linkedin:|campaign:)/.test(t)) n.set(t, (n.get(t) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  },
  async addTags({ id, tags, url }) {
    const c = await api("GET", `/contacts/${id}`);
    const next = [...new Set([...(c.tags || []), ...(tags || []).map((t) => String(t).trim()).filter(Boolean)])];
    await api("PATCH", `/contacts/${id}`, { tags: next });
    cache.at = 0;
    return lookup(url);
  },
  // One-click stage: replaces any stage:* tag.
  async setStage({ id, stage, url }) {
    const c = await api("GET", `/contacts/${id}`);
    const tags = (c.tags || []).filter((t) => !t.startsWith("stage:"));
    if (stage) tags.push(`stage:${stage}`);
    await api("PATCH", `/contacts/${id}`, { tags });
    await api("POST", `/contacts/${id}/interactions`, { channel: "note", summary: `Stage → ${stage || "none"} (from LinkedIn)` });
    cache.at = 0;
    return lookup(url);
  },

  // ── Posts ──
  async savePost({ post }) {
    const posts = await getPosts();
    if (!posts.some((x) => x.id === post.id)) posts.unshift({ ...post, savedAt: new Date().toISOString() });
    await setPosts(posts.slice(0, 500));
    return { saved: true, count: posts.length };
  },
  async setPostUrl({ id, url }) {
    const posts = await getPosts();
    const p = posts.find((x) => x.id === id);
    if (p) { p.url = url; await setPosts(posts); }
    return { ok: true };
  },
  async unsavePost({ id }) {
    await setPosts((await getPosts()).filter((x) => x.id !== id));
    return { ok: true };
  },
  posts: () => getPosts(),

  // ── Comments you left, and how visible they were ──
  // Recorded when you press Comment on LinkedIn; reactions and impressions
  // are filled in when you open your Comments activity page.
  async logComment({ post, comment, pageUrl }) {
    const { comments = [] } = await chrome.storage.local.get("comments");
    const id = post.id + ":" + hashStr(comment.slice(0, 60));
    if (!comments.some((c) => c.id === id)) {
      comments.unshift({ id, postId: post.id, author: post.author, postText: (post.text || "").slice(0, 400), comment, at: new Date().toISOString(), pageUrl, reactions: 0, impressions: 0, source: "live" });
      await chrome.storage.local.set({ comments: comments.slice(0, 2000) });
    }
    // A comment on someone in your contacts is a touch: put it in their history.
    const { bySlug } = await contacts().catch(() => ({}));
    const c = bySlug?.get(slugOf(post.author?.url));
    if (c) await api("POST", `/contacts/${c.id}/interactions`, { channel: "note", summary: `Commented on their post: “${comment.slice(0, 200)}”` }).catch(() => {});
    return { ok: true, count: comments.length };
  },
  async syncComments({ items }) {
    const { comments = [] } = await chrome.storage.local.get("comments");
    let added = 0, updated = 0;
    const now = new Date().toISOString();
    for (const it of items) {
      const key = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 40);
      let c = comments.find((x) => x.postId === it.postId && key(x.comment) === key(it.comment)) || comments.find((x) => x.postId === it.postId && !x.checkedAt);
      if (!c) {
        c = { id: it.postId + ":" + hashStr(it.comment.slice(0, 60)), postId: it.postId, author: it.author, postText: it.postText.slice(0, 400), comment: it.comment, at: it.at, pageUrl: "", source: "imported" };
        comments.push(c); added++;
      } else updated++;
      Object.assign(c, { reactions: it.reactions, impressions: it.impressions, replies: it.replies, checkedAt: now });
    }
    comments.sort((a, b) => b.at.localeCompare(a.at));
    await chrome.storage.local.set({ comments: comments.slice(0, 2000) });
    return { added, updated };
  },
  async visibilitySnapshot({ v }) {
    const { visibility = {} } = await chrome.storage.local.get("visibility");
    const d = new Date(); const day = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    visibility[day] = { ...visibility[day], ...v };
    await chrome.storage.local.set({ visibility });
    return { ok: true };
  },
  async visibility() {
    const { comments = [], visibility = {} } = await chrome.storage.local.get(["comments", "visibility"]);
    return { comments, snapshots: visibility };
  },
  reviewPost: ({ id }) => reviewPost(id),
  // Add the author to Contacts with the post as the reason.
  async postAuthorToContacts({ id }) {
    const p = (await getPosts()).find((x) => x.id === id);
    if (!p?.author?.url || !/linkedin\.com\/in\//.test(p.author.url)) throw new Error("This post's author is not a person's profile.");
    const icp = p.review && p.review.icp !== "none" && self.ICPS.some((i) => i.id === p.review.icp) ? [`icp:${p.review.icp}`] : [];
    const r = await save({
      url: p.author.url, name: p.author.name, title: p.author.headline || "",
      tags: [...icp, "from-post"],
      reason: p.review?.why || `Their post: ${p.text.slice(0, 160)}`,
      note: `Saved post (${p.savedAt.slice(0, 10)}): ${p.text.slice(0, 400)}${p.text.length > 400 ? "…" : ""}`,
    });
    const posts = await getPosts();
    const q = posts.find((x) => x.id === id);
    if (q) { q.contactId = r.contact?.id; await setPosts(posts); }
    return { contactId: r.contact?.id, appUrl: r.contact?.appUrl };
  },

  // ── Rhythm: daily goals, streak, history, time on LinkedIn ──
  async rhythm() {
    const { goals: g = {}, time = {}, comments = [] } = await chrome.storage.local.get(["goals", "time", "comments"]);
    const goals = { reach: 5, follow: 3, review: 10, comment: 3, ...g };
    const { events = [] } = await api("GET", "/events");
    const day = (iso) => {
      const d = new Date(iso);
      return isNaN(d) ? null : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    };
    // One count per person per kind per day.
    const seen = new Set();
    const days = {};
    for (const e of events) {
      if (e.kind === "added" || e.kind === "follow-up") continue;
      const t = String(e.text || "");
      let k = null;
      if (/^(Asked to connect|Connection note sent|Messaged on LinkedIn)/.test(t)) k = "reach";
      else if (/^(Kept|Skipped) from suggestions/.test(t)) k = "review";
      else if (/^They |^Stage →|^Accepted the LinkedIn|^Reason for the LinkedIn/.test(t)) k = null;
      else if (/^(Followed up|I wrote on LinkedIn)/.test(t) || ["message", "email", "call", "meeting"].includes(e.kind)) k = "follow";
      const d = day(e.date);
      if (!k || !d || seen.has(`${d}|${k}|${e.contactId}`)) continue;
      seen.add(`${d}|${k}|${e.contactId}`);
      (days[d] ||= { reach: 0, follow: 0, review: 0 })[k]++;
    }
    for (const c of comments) { const d = day(c.at); if (d) { (days[d] ||= { reach: 0, follow: 0, review: 0 }).comment = ((days[d].comment || 0) + 1); } }
    for (const [d, t] of Object.entries(time)) (days[d] ||= { reach: 0, follow: 0, review: 0 }).time = t;
    // Next people to reach: kept leads nobody asked yet, best ICP first.
    const { contacts: list } = await contacts();
    const rank = (c) => Math.min(...(c.tags || []).map((x) => self.ICPS.find((i) => `icp:${i.id}` === x)?.rank || 9), 9);
    const toReach = list
      .filter((c) => {
        const t = c.tags || [];
        return t.includes("stage:lead") && !t.includes("suggested") && !t.some((x) => /^linkedin:(requested|connected)$/.test(x));
      })
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 12)
      .map((c) => ({
        id: c.id, name: c.name, title: c.title || "", company: c.company || "",
        why: reasonsOf(c.notes)[0]?.text || "",
        icp: self.ICPS.find((i) => (c.tags || []).includes(`icp:${i.id}`))?.name || "",
        linkedin: slugOf(c.linkedin) ? `https://www.linkedin.com/${slugOf(c.linkedin)}/` : `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([c.name, c.company].filter(Boolean).join(" "))}`,
      }));
    const toReview = list.filter((c) => (c.tags || []).includes("suggested")).length;
    return { goals, days, today: day(new Date().toISOString()), toReach, toReview, due: await handlers.due() };
  },
  async setGoals({ goals }) {
    await chrome.storage.local.set({ goals });
    return { ok: true };
  },

  // ── Dashboard ──
  // Everyone you've reached out to (a campaign, or a LinkedIn request),
  // with how far they got: 0 saved · 1 asked · 2 accepted · 3 replied · 4 call+ · 5 won.
  async outreach() {
    const { contacts: list } = await contacts();
    const { pitches = {} } = await chrome.storage.local.get("pitches");
    // App lists are outreach batches too: show them by name next to campaigns.
    const { lists = [] } = await api("GET", "/lists").catch(() => ({}));
    const listName = new Map(lists.map((l) => [`list:${l.id}`, l.name]));
    const people = [];
    for (const c of list) {
      const t = c.tags || [];
      const campaigns = t.filter((x) => x.startsWith("campaign:")).map((x) => x.slice(9));
      const inLists = t.filter((x) => listName.has(x)).map((x) => listName.get(x));
      const stage = (t.find((x) => x.startsWith("stage:")) || "").slice(6);
      if (t.includes("suggested:skipped")) continue;
      const icpTagged = t.some((x) => self.ICPS.some((i) => x === `icp:${i.id}`));
      if (!icpTagged && !campaigns.length && !inLists.length && !stage && !t.some((x) => /^(linkedin:(requested|connected|replied)|suggested)$/.test(x))) continue;
      const level = stage === "won" ? 5
        : /^(call|trial|proposal)$/.test(stage) ? 4
        : t.includes("linkedin:replied") ? 3
        : t.includes("linkedin:connected") ? 2
        : t.includes("linkedin:requested") || stage === "contacted" ? 1 : 0;
      people.push({
        id: c.id, name: c.name, title: c.title || "", company: c.company || "",
        campaigns, groups: [...new Set([...campaigns, ...inLists])], stage, level, lost: stage === "lost",
        suggested: t.includes("suggested"),
        offers: t.filter((x) => x.startsWith("offer:")).map((x) => x.slice(6)),
        icps: t.filter((x) => x.startsWith("icp:")).map((x) => x.slice(4)).filter((x) => self.ICPS.some((i) => i.id === x)),
        notes: t.includes("suggested") ? c.notes || "" : "",
        email: c.email || "",
        why: reasonsOf(c.notes)[0]?.text || firstLine(c.notes),
        added: (c.createdAt || "").slice(0, 10),
        linkedin: slugOf(c.linkedin) ? `https://www.linkedin.com/${slugOf(c.linkedin)}/` : "",
        appUrl: `${APP_URL}#c/${c.id}`,
      });
    }
    return { people, pitches, listNames: lists.map((l) => l.name) };
  },
  // Suggested people: keep (they become a lead to reach out to) or skip.
  async markAsked({ id }) {
    const c = await api("GET", `/contacts/${id}`);
    const tags = (c.tags || []).filter((t) => !t.startsWith("stage:"));
    if (!tags.includes("linkedin:requested")) tags.push("linkedin:requested");
    tags.push("stage:contacted");
    const at = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await api("PATCH", `/contacts/${id}`, { tags, followUpAt: at, followUpNote: "Did they accept? Send a first message." });
    await api("POST", `/contacts/${id}/interactions`, { channel: "note", summary: "Asked to connect (marked in the dashboard)" });
    cache.at = 0;
    return { ok: true };
  },
  async review({ id, keep }) {
    const c = await api("GET", `/contacts/${id}`);
    const tags = (c.tags || []).filter((t) => t !== "suggested" && !t.startsWith("suggested:"));
    tags.push(keep ? "suggested:kept" : "suggested:skipped");
    if (keep && !tags.some((t) => t.startsWith("stage:"))) tags.push("stage:lead");
    await api("PATCH", `/contacts/${id}`, { tags });
    await api("POST", `/contacts/${id}/interactions`, { channel: "note", summary: keep ? "Kept from suggestions" : "Skipped from suggestions" });
    cache.at = 0;
    return { ok: true };
  },
  async openDashboard({ campaign, page }) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") + (page ? "#" + page : campaign ? "#" + encodeURIComponent(campaign) : "") });
    return { ok: true };
  },

  // ── Campaigns (0.4) ──
  // Per campaign: people, asked, accepted, replied, call or later.
  async campaignStats() {
    const { contacts: list } = await contacts();
    const by = new Map();
    for (const c of list) {
      const tags = c.tags || [];
      for (const t of tags) {
        if (!t.startsWith("campaign:")) continue;
        const s = by.get(t.slice(9)) || { name: t.slice(9), people: 0, asked: 0, accepted: 0, replied: 0, call: 0 };
        // Same steps as the dashboard funnel: reaching a later step counts for the earlier ones.
        const call = tags.some((x) => /^stage:(call|trial|proposal|won)$/.test(x));
        const replied = call || tags.includes("linkedin:replied");
        const accepted = replied || tags.includes("linkedin:connected");
        s.people++;
        if (accepted || tags.includes("linkedin:requested")) s.asked++;
        if (accepted) s.accepted++;
        if (replied) s.replied++;
        if (call) s.call++;
        by.set(s.name, s);
      }
    }
    const { pitches = {} } = await chrome.storage.local.get("pitches");
    return [...by.values()].sort((a, b) => b.people - a.people).map((s) => ({ ...s, pitch: pitches[s.name] || "" }));
  },
  async campaignMembers({ name }) {
    const tag = campaignTag(name);
    const { contacts: list } = await contacts();
    return list.filter((c) => (c.tags || []).includes(tag)).map((c) => {
      const t = c.tags || [];
      const status = t.some((x) => /^stage:(call|trial|proposal|won)$/.test(x)) ? (t.find((x) => x.startsWith("stage:")) || "").slice(6)
        : t.includes("linkedin:replied") ? "replied"
        : t.includes("linkedin:connected") ? "accepted"
        : t.includes("linkedin:requested") ? "asked" : (t.find((x) => x.startsWith("stage:")) || "").slice(6) || "saved";
      return {
        id: c.id, name: c.name, title: c.title || "", company: c.company || "", status,
        why: reasonsOf(c.notes)[0]?.text || "",
        linkedin: slugOf(c.linkedin) ? `https://www.linkedin.com/${slugOf(c.linkedin)}/` : "",
        appUrl: `${APP_URL}#c/${c.id}`,
      };
    });
  },
  async savePitch({ name, pitch }) {
    const { pitches = {} } = await chrome.storage.local.get("pitches");
    pitches[campaignTag(name).slice(9)] = String(pitch || "").trim();
    await chrome.storage.local.set({ pitches });
    return { ok: true };
  },
  // Make (or reuse) a list in the app named after the campaign, and put everyone in it.
  async campaignToList({ name }) {
    const members = await handlers.campaignMembers({ name });
    const { lists } = await api("GET", "/lists");
    let l = (lists || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!l) l = await api("POST", "/lists", { name });
    const r = await api("POST", `/lists/${l.id}/members`, { ids: members.map((m) => m.id) });
    cache.at = 0;
    return { id: l.id, name: l.name, added: r.count ?? members.length, total: members.length, appUrl: `${APP_URL}#lists` };
  },

  // ── Messaging (0.5) ──
  // They wrote back: mark it once.
  async replied({ id, url }) {
    const c = await api("GET", `/contacts/${id}`);
    if (!(c.tags || []).includes("linkedin:replied")) {
      await api("PATCH", `/contacts/${id}`, { tags: [...(c.tags || []), "linkedin:replied"] });
    }
    cache.at = 0;
    return lookup(url);
  },

  // ── Drafting (0.6) ──
  draft: (p) => draft(p),
  async openOptions() {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  },
  async refresh() {
    await contacts(true);
    return { ok: true };
  },
  async status() {
    const { apiKey } = await config();
    try {
      const { contacts: list } = await contacts(true);
      return { ok: true, count: list.length, usingKey: Boolean(apiKey) };
    } catch (e) {
      return { ok: false, error: e.message, usingKey: Boolean(apiKey) };
    }
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const fn = handlers[msg?.type];
  if (!fn) return false;
  Promise.resolve(fn(msg))
    .then((data) => reply({ ok: true, data }))
    .catch((e) => reply({ ok: false, error: e.message }));
  return true;
});

// Toolbar button: on LinkedIn, open the panel; elsewhere, open settings.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id && /^https:\/\/www\.linkedin\.com\//.test(tab.url || "")) {
    chrome.tabs.sendMessage(tab.id, { type: "toggle" }).catch(() => chrome.runtime.openOptionsPage());
  } else {
    chrome.runtime.openOptionsPage();
  }
});

// Clicking an "accepted" notification opens their profile.
chrome.notifications?.onClicked.addListener(async (nid) => {
  if (!nid.startsWith("accepted:")) return;
  const { acceptedQueue = [] } = await chrome.storage.local.get("acceptedQueue");
  const p = acceptedQueue.find((x) => "accepted:" + x.id === nid);
  if (p?.url) chrome.tabs.create({ url: p.url });
  chrome.notifications.clear(nid);
});
