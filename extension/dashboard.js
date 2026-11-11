// Outreach dashboard: a funnel for all campaigns or one, every campaign side
// by side, and the people at each step. Data comes from background.js.

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const send = (type, p = {}) => chrome.runtime.sendMessage({ type, ...p });
const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "–");

const STEPS = [
  { k: 0, label: "Saved", tip: "Everyone in this view: in a campaign or list, with a stage, or sent a LinkedIn request" },
  { k: 1, label: "Asked", tip: "You reached out: a connection request, or stage contacted (or further)" },
  { k: 2, label: "Accepted", tip: "They accepted your connection request" },
  { k: 3, label: "Replied", tip: "They wrote back on LinkedIn" },
  { k: 4, label: "Call+", tip: "Reached stage call, trial or proposal (or further)" },
  { k: 5, label: "Won", tip: "Stage won" },
];
const color = (k) => `var(--s${k})`;
const NONE = "__none";

let data = { people: [], pitches: {} };
let filter = /^#(today|posts)$/.test(location.hash) ? "" : decodeURIComponent(location.hash.slice(1));

const ICPS = self.ICPS || [];
const icpOf = (id) => ICPS.find((i) => i.id === id);
const inView = (p, f = filter) => (!f ? true : f === NONE ? !p.groups.length : f.startsWith("icp:") ? (p.icps || []).includes(f.slice(4)) : p.groups.includes(f));
const reached = (list, k) => list.filter((p) => p.level >= k && !p.suggested).length;

function campaigns() {
  const m = new Map();
  for (const p of data.people) for (const c of p.groups) m.set(c, (m.get(c) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
}

function renderFilters() {
  renderIcps();
  const none = data.people.filter((p) => !p.groups.length).length;
  const chips = [{ v: "", label: "Everyone", n: data.people.length }, ...campaigns().map((c) => ({ v: c.name, label: c.name, n: c.n }))];
  if (none) chips.push({ v: NONE, label: "No campaign or list", n: none });
  $("filters").innerHTML = chips.map((c) => `<button class="chip ${c.v === filter ? "on" : ""}" data-v="${esc(c.v)}">${esc(c.label)}<span class="n">${c.n}</span></button>`).join("");
  $("filters").querySelectorAll(".chip").forEach((b) => b.onclick = () => setFilter(b.dataset.v));
}

// ICP cards: who you're looking for, with how many are waiting.
function renderIcps() {
  $("icps").innerHTML = ICPS.map((i) => {
    const l = data.people.filter((p) => (p.icps || []).includes(i.id));
    const todo = l.filter((p) => p.suggested).length;
    const kept = l.length - todo;
    return `<button class="icp ${filter === "icp:" + i.id ? "on" : ""}" data-icp="${i.id}" data-tip="${esc(i.person)}">
      <div class="rk">ICP ${i.rank}</div><div class="nm">${esc(i.name)}</div>
      <div class="ct">${todo ? `<b>${todo}</b> to review` : "nothing to review"}${kept ? ` · ${kept} kept` : ""}</div></button>`;
  }).join("");
  $("icps").querySelectorAll("[data-icp]").forEach((b) => b.onclick = () => { tab = null; reviewAt = 0; setFilter(filter === "icp:" + b.dataset.icp ? "" : "icp:" + b.dataset.icp); });
}

// The full "who am I looking for" spec for one ICP.
function persona(i, open) {
  const row = (k, v, cls = "") => `<div class="${cls}" style="display:contents"><dt>${k}</dt><dd>${esc(v)}</dd></div>`;
  return `<div class="persona">
    <div class="lead">ICP ${i.rank} · who you're looking for</div>
    <h3>${esc(i.name)}</h3>
    <p class="who">${esc(i.person)}</p>
    <details ${open ? "open" : ""}><summary>The full profile</summary><dl>
      ${row("Title", i.title)}${row("Company", i.company)}${row("Builds", i.builds)}${row("Runs it on", i.today)}${row("Pain", i.pain)}${row("Look for", i.signal)}${row("Not them", i.notThem, "no")}${row("You offer", i.offer)}
      <dt>Find more</dt><dd><a href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(i.find)}" target="_blank" rel="noopener">Search LinkedIn: “${esc(i.find)}” ↗</a></dd>
    </dl></details>
  </div>`;
}

function setFilter(v) {
  filter = v;
  history.replaceState(null, "", v ? "#" + encodeURIComponent(v) : location.pathname);
  render();
}

function funnel(list) {
  const top = list.length || 1;
  const rows = STEPS.map((s, i) => {
    const n = reached(list, s.k);
    const prev = i ? reached(list, STEPS[i - 1].k) : n;
    return `${i ? `<div class="step">↓ ${pct(n, prev)} of ${STEPS[i - 1].label.toLowerCase()}</div>` : ""}
      <div class="fr"><div class="lab" data-tip="${esc(s.tip)}">${s.label}</div>
      <div class="bar"><i style="width:${(100 * n) / top}%;background:${color(s.k)}"></i></div>
      <div class="num"><b>${n}</b><span>${pct(n, list.length)}</span></div></div>`;
  }).join("");
  const asked = reached(list, 1), acc = reached(list, 2), rep = reached(list, 3), call = reached(list, 4);
  const lost = list.filter((p) => p.lost).length;
  return `<div class="fn">${rows}</div>
    <div class="kpis">
      <div class="kpi" data-tip="Accepted ÷ asked"><b>${pct(acc, asked)}</b><span>accept rate</span></div>
      <div class="kpi" data-tip="Replied ÷ accepted"><b>${pct(rep, acc)}</b><span>reply rate</span></div>
      <div class="kpi" data-tip="Call or later ÷ asked"><b>${pct(call, asked)}</b><span>asked → call</span></div>
      ${lost ? `<div class="kpi" data-tip="Marked stage lost"><b>${lost}</b><span>lost</span></div>` : ""}
    </div>`;
}

function spark(list) {
  const top = list.length || 1;
  return `<span class="spark">${STEPS.map((s) => `<i style="height:${Math.max(2, (18 * reached(list, s.k)) / top)}px;background:${color(s.k)}"></i>`).join("")}</span>`;
}

function table() {
  const rows = [{ name: "", label: "Everyone" }, ...campaigns().map((c) => ({ name: c.name, label: c.name }))];
  if (data.people.some((p) => !p.groups.length)) rows.push({ name: NONE, label: "No campaign or list" });
  return `<table>
    <tr><th>Campaign / list</th><th data-tip="People in the campaign">People</th><th data-tip="Saved → asked → accepted → replied → call+ → won">Funnel</th><th data-tip="Sent a connection request">Asked</th><th data-tip="Accepted, and % of asked">Accepted</th><th data-tip="Wrote back, and % of accepted">Replied</th><th data-tip="Call, trial, proposal or won">Call+</th></tr>
    ${rows.map((r) => {
      const l = data.people.filter((p) => inView(p, r.name));
      const asked = reached(l, 1), acc = reached(l, 2), rep = reached(l, 3);
      return `<tr class="row ${r.name === filter ? "on" : ""}" data-v="${esc(r.name)}">
        <td class="cn">${esc(r.label)}</td><td>${l.length}</td><td>${spark(l)}</td><td>${asked}</td>
        <td>${acc} <span class="pct">${pct(acc, asked)}</span></td><td>${rep} <span class="pct">${pct(rep, acc)}</span></td><td>${reached(l, 4)}</td></tr>`;
    }).join("")}
  </table>`;
}

// ── Review: one suggested person at a time ──
const linkify = (t) => esc(t).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 50)}${u.length > 62 ? "…" : ""}</a>`);
let reviewAt = 0;
const profileLink = (p) => p.linkedin || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([p.name.split(/[;,]/)[0], p.company].filter(Boolean).join(" "))}`;
function parseNotes(p) {
  const lines = p.notes.split("\n").map((l) => l.trim()).filter(Boolean);
  const take = (re) => (lines.find((l) => re.test(l)) || "").replace(re, "").trim();
  return {
    why: take(/^Why connect[^:]*:\s*/),
    useCase: take(/^Use case:\s*/),
    evidence: take(/^Evidence:\s*/),
    source: take(/^Source:\s*/),
    fit: take(/^Fit\s*/),
    other: lines.filter((l) => !/^(Why connect|Use case:|Evidence:|Source:|Fit )/.test(l)),
  };
}
function review(list) {
  if (!list.length) return `<div class="card empty"><b>All reviewed.</b><br>The ones you kept are in the funnel as leads.</div>`;
  reviewAt = Math.min(reviewAt, list.length - 1);
  const p = list[reviewAt];
  const n = parseNotes(p);
  const score = (n.fit.match(/^(\d+)\/25/) || [])[1];
  return `<div class="focus">
    <div class="prog"><span>${reviewAt + 1} of ${list.length}</span><div class="pbar"><i style="width:${(100 * (reviewAt + 1)) / list.length}%"></i></div>
      <button class="nav" id="prev" ${reviewAt ? "" : "disabled"} data-tip="Previous (←)">‹</button><button class="nav" id="next" ${reviewAt < list.length - 1 ? "" : "disabled"} data-tip="Next without deciding (→)">›</button></div>
    <div class="fc">
      <div class="fc-head">
        <div><div class="fc-name">${esc(p.name)}</div><div class="fc-role">${esc([p.title, p.company].filter(Boolean).join(" · "))}</div></div>
        ${score ? `<div class="fit" data-tip="${esc("Fit score from research (need, no infra, can adopt, reachable, pays in 90 days)\n" + n.fit)}"><b>${score}</b><span>/25</span></div>` : ""}
      </div>
      ${(p.icps || []).map((id) => icpOf(id) ? `<div class="icp-badge" data-tip="${esc(icpOf(id).person)}">ICP ${icpOf(id).rank} · ${esc(icpOf(id).name)}</div>` : "").join(" ")}
      ${n.why ? `<div class="fc-why">${esc(n.why)}</div>` : ""}
      ${n.useCase ? `<div class="fc-row"><span>What they build</span>${esc(n.useCase)}</div>` : ""}
      ${n.evidence || n.source ? `<details class="fc-more"><summary>Evidence and source</summary>
        ${n.evidence ? `<p>${esc(n.evidence)}</p>` : ""}${n.source ? `<p>${linkify(n.source)}</p>` : ""}${n.other.map((l) => `<p>${linkify(l)}</p>`).join("")}</details>` : ""}
      <div class="fc-links"><a href="${esc(profileLink(p))}" target="_blank" rel="noopener">${p.linkedin ? "Open LinkedIn ↗" : "Find on LinkedIn ↗"}</a>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ""}</div>
    </div>
    <div class="fc-act">
      <button class="big" data-skip="${esc(p.id)}">Skip <kbd>S</kbd></button>
      <button class="big primary" data-keep="${esc(p.id)}">Keep <kbd>K</kbd></button>
    </div>
    <div class="hint">K keep · S skip · L open LinkedIn · ← → move</div>
  </div>`;
}

function people(list) {
  list = list.filter((p) => !p.suggested);
  const groups = [...STEPS].reverse().map((s) => ({ s, list: list.filter((p) => p.level === s.k && !p.lost) }));
  const lost = list.filter((p) => p.lost);
  const item = (p) => `<div class="p"><a href="${esc(p.linkedin || p.appUrl)}" target="_blank" rel="noopener">${esc(p.name)}</a>${filter ? "" : p.groups.slice(0, 2).map((c) => `<span class="tag">${esc(c)}</span>`).join("")}
      ${p.title || p.company ? `<div class="sub">${esc([p.title, p.company].filter(Boolean).join(" · "))}</div>` : ""}
      ${p.why ? `<div class="why" data-tip="${esc("Why you wanted to connect:\n" + p.why)}">${esc(p.why)}</div>` : ""}</div>`;
  const label = { 0: "Saved, not asked yet", 1: "Asked, waiting", 2: "Accepted, no reply yet", 3: "Replied", 4: "Call or later", 5: "Won" };
  return `<div class="people">
    ${groups.filter((g) => g.list.length).map((g) => `<div class="grp"><h3><i style="background:${color(g.s.k)}"></i>${label[g.s.k]} <span class="muted">${g.list.length}</span></h3>${g.list.map(item).join("")}</div>`).join("")}
    ${lost.length ? `<div class="grp"><h3><i style="background:var(--ink3)"></i>Lost <span class="muted">${lost.length}</span></h3>${lost.map(item).join("")}</div>` : ""}
  </div>`;
}

let tab = null; // "review" | "funnel"
function render() {
  if (typeof page !== "undefined" && page !== "people") { page = "people"; renderPage(); return; }
  renderFilters();
  const list = data.people.filter((p) => inView(p));
  if (!data.people.length) {
    $("main").innerHTML = `<div class="card empty">No outreach yet. Add a campaign when you save someone on LinkedIn, or press Connect there.</div>`;
    return;
  }
  const real = filter && filter !== NONE && !filter.startsWith("icp:");
  const toReview = list.filter((p) => p.suggested);
  const t = tab || (toReview.length ? "review" : "funnel");
  const tabs = `<div class="tabs"><button class="${t === "review" ? "on" : ""}" data-tab="review">Review${toReview.length ? ` <span class="badge">${toReview.length}</span>` : ""}</button><button class="${t === "funnel" ? "on" : ""}" data-tab="funnel">Funnel</button></div>`;
  const icp = filter.startsWith("icp:") ? icpOf(filter.slice(4)) : null;
  $("main").innerHTML = tabs + (t === "review" ? (icp ? persona(icp, reviewAt === 0) : "") + review(toReview) : (icp ? persona(icp, false) : "") + `<div class="grid">
    <div class="card"><h2>Funnel · ${esc(icp ? icp.name : !filter ? "everyone you've reached out to" : filter === NONE ? "no campaign or list" : filter)}</h2>${funnel(list)}</div>
    <div class="card"><h2>Campaigns and lists</h2>${table()}</div>
    ${real ? `<div class="card full"><h2>What ${esc(filter)} is about</h2>
      <textarea id="pitch" placeholder="Used when drafting notes and messages for people in this campaign.">${esc(data.pitches[filter] || "")}</textarea>
      <div class="row-actions"><button class="btn" id="savePitch">Save</button>${(data.listNames || []).includes(filter) ? "" : `<button class="btn" id="toList" data-tip="Creates a list named ${esc(filter)} in the Contacts app with everyone in it">Make a list in Contacts</button>`}<span id="msg"></span></div></div>` : ""}
    <div class="card full"><h2>People · ${list.length - toReview.length}</h2>${people(list)}</div>
  </div>`);
  document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { tab = b.dataset.tab; render(); });
  document.querySelectorAll("tr.row").forEach((tr) => tr.onclick = () => setFilter(tr.dataset.v));
  document.querySelectorAll("[data-keep], [data-skip]").forEach((b) => b.onclick = () => decide(b.dataset.keep || b.dataset.skip, Boolean(b.dataset.keep)));
  $("prev")?.addEventListener("click", () => { reviewAt--; render(); });
  $("next")?.addEventListener("click", () => { reviewAt++; render(); });
  if (real && $("savePitch")) {
    $("savePitch").onclick = async () => { await send("savePitch", { name: filter, pitch: $("pitch").value }); data.pitches[filter] = $("pitch").value.trim(); $("msg").textContent = "Saved."; };
    if ($("toList")) $("toList").onclick = async () => {
      $("toList").disabled = true;
      const r = await send("campaignToList", { name: filter });
      $("msg").innerHTML = r.ok ? `List “${esc(r.data.name)}” has ${r.data.total} people. <a href="${esc(r.data.appUrl)}" target="_blank" rel="noopener">Open ↗</a>` : `<span class="err">${esc(r.error)}</span>`;
      $("toList").disabled = false;
    };
  }
}

let busy = false;
async function decide(id, keep) {
  if (busy) return;
  busy = true;
  document.querySelector(".fc")?.classList.add(keep ? "kept" : "skipped");
  const r = await send("review", { id, keep });
  busy = false;
  if (!r?.ok) { document.querySelector(".fc")?.classList.remove("kept", "skipped"); alert(r?.error || "Could not save"); return; }
  const p = data.people.find((x) => x.id === id);
  if (keep) { p.suggested = false; p.stage = p.stage || "lead"; } else data.people = data.people.filter((x) => x.id !== id);
  render(); // the next person slides into the same position
}

document.addEventListener("keydown", (e) => {
  if (!document.querySelector(".focus") || e.target.closest("textarea, input") || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === "k") document.querySelector("[data-keep]")?.click();
  else if (k === "s") document.querySelector("[data-skip]")?.click();
  else if (k === "l") document.querySelector(".fc-links a")?.click();
  else if (e.key === "ArrowRight") $("next")?.click();
  else if (e.key === "ArrowLeft") $("prev")?.click();
});

async function load(force) {
  if (force) await send("refresh");
  const r = await send("outreach");
  if (!r?.ok) { $("main").innerHTML = `<div class="card empty err">${esc(r?.error || "Could not reach Contacts.")}</div>`; return; }
  data = r.data;
  if (page === "people") render(); else renderFilters();
}

$("reload").onclick = async () => { await load(true); const r = await send("rhythm"); if (r?.ok) { rhythm = r.data; if (page === "today") renderToday(); } };
addEventListener("hashchange", () => { if (/^#(today|posts)$/.test(location.hash)) return; filter = decodeURIComponent(location.hash.slice(1)); if (page === "people") render(); });

// Tooltips
let t = null;
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest("[data-tip]");
  clearTimeout(t);
  if (!el) { $("tip").style.display = "none"; return; }
  t = setTimeout(() => {
    const tip = $("tip");
    tip.textContent = el.dataset.tip;
    tip.style.display = "block";
    const r = el.getBoundingClientRect();
    tip.style.left = Math.min(Math.max(r.left + r.width / 2 - tip.offsetWidth / 2, 6), innerWidth - tip.offsetWidth - 6) + "px";
    tip.style.top = (r.top > tip.offsetHeight + 10 ? r.top - tip.offsetHeight - 6 : r.bottom + 6) + "px";
  }, 250);
});

load();

// ── Today: goals, what to do next, streak, the grid of your days, time ──
const KINDS = [
  ["profiles", "Profiles", "#5e5ce6"], ["search", "Search", "#0a84ff"], ["messages", "Messages", "#34c759"],
  ["network", "Network", "#64d2ff"], ["feed", "Feed", "#ff9f0a"], ["notifications", "Notifications", "#bf5af2"],
  ["jobs", "Jobs", "#ac8e68"], ["other", "Other", "#a1a1a6"],
];
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const mins = (s) => Math.round((s || 0) / 60);
const sumTime = (t) => Object.values(t || {}).reduce((a, b) => a + b, 0);
let rhythm = null;
let editingGoals = false;

const met = (d, g) => d && d.reach >= g.reach && d.follow >= g.follow;
function streaks(days, g, today) {
  let cur = 0;
  const d = new Date(today + "T12:00:00");
  if (!met(days[today], g)) d.setDate(d.getDate() - 1); // today still counts as "keep it alive"
  while (met(days[ymd(d)], g)) { cur++; d.setDate(d.getDate() - 1); }
  let best = 0, run = 0;
  const keys = Object.keys(days).sort();
  if (keys.length) {
    const x = new Date(keys[0] + "T12:00:00");
    for (; ymd(x) <= today; x.setDate(x.getDate() + 1)) { run = met(days[ymd(x)], g) ? run + 1 : 0; best = Math.max(best, run); }
  }
  return { cur, best };
}

function ring(done, goal, color) {
  const f = Math.min(done / (goal || 1), 1), r = 26, c = 2 * Math.PI * r;
  return `<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--line)" stroke-width="6"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c * f} ${c}" transform="rotate(-90 32 32)"/>
    <text x="32" y="37" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor">${done}/${goal}</text></svg>`;
}

function coach(r, t) {
  const g = r.goals, tm = r.days[r.today]?.time || {};
  const total = sumTime(tm), feed = tm.feed || 0;
  const reachLeft = Math.max(g.reach - (t.reach || 0), 0), followLeft = Math.max(g.follow - (t.follow || 0), 0);
  if (reachLeft && !r.toReach.length && r.toReview) return { text: `You have no leads ready. Review suggestions first: ${r.toReview} waiting.`, go: "review", label: "Start reviewing" };
  if (followLeft && r.due.length) return { text: `Follow up with ${r.due[0].name} first. ${r.due.length} follow-up${r.due.length === 1 ? " is" : "s are"} waiting, the oldest since ${r.due[0].at}.`, href: r.due[0].linkedin || r.due[0].appUrl, label: `Open ${r.due[0].name.split(" ")[0]}` };
  if (reachLeft && r.toReach.length) return { text: `Reach out to ${reachLeft} more ${reachLeft === 1 ? "person" : "people"} today. Start with ${r.toReach[0].name}${r.toReach[0].company ? ` (${r.toReach[0].company})` : ""}.`, href: r.toReach[0].linkedin, label: `Open ${r.toReach[0].name.split(" ")[0]}` };
  if (total > 600 && feed / total > 0.5) return { text: `${mins(feed)} of your ${mins(total)} minutes today went to the feed. Goals are done, so close LinkedIn.` };
  if (!reachLeft && !followLeft) return { text: "Today's goals are done. Close LinkedIn, or review suggestions for tomorrow.", go: r.toReview ? "review" : null, label: "Review for tomorrow" };
  return { text: "Add leads: review suggestions or save people from a LinkedIn search.", go: "review", label: "Review" };
}

function heatmap(r) {
  const weeks = 52, end = new Date(r.today + "T12:00:00");
  const start = new Date(end); start.setDate(start.getDate() - (weeks * 7 - 1) - end.getDay());
  const cells = [];
  let months = "";
  for (let w = 0; w < weeks + 1; w++) {
    let col = "";
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(start); d.setDate(start.getDate() + w * 7 + dow);
      const k = ymd(d);
      if (k > r.today) { col += `<i class="hm-x"></i>`; continue; }
      const v = r.days[k] || { reach: 0, follow: 0, review: 0 };
      const n = v.reach + v.follow + Math.ceil(v.review / 3);
      const lvl = n === 0 ? 0 : n < 3 ? 1 : n < 6 ? 2 : n < 10 ? 3 : 4;
      const tip = `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}\n${v.reach} reached out · ${v.follow} follow-ups · ${v.review} reviewed${v.time ? `\n${mins(sumTime(v.time))} min on LinkedIn` : ""}${met(v, r.goals) ? "\nGoals met" : ""}`;
      col += `<i class="hm l${lvl} ${met(v, r.goals) ? "met" : ""} ${k === r.today ? "now" : ""}" data-tip="${esc(tip)}"></i>`;
      if (dow === 0 && d.getDate() <= 7) months += `<span style="grid-column:${w + 1}">${d.toLocaleDateString(undefined, { month: "short" })}</span>`;
    }
    cells.push(`<div class="hm-col">${col}</div>`);
  }
  return `<div class="hm-wrap"><div class="hm-months" style="grid-template-columns:repeat(${weeks + 1},17px)">${months}</div><div class="hm-grid">${cells.join("")}</div>
    </div><div class="hm-legend">Less <i class="hm l0"></i><i class="hm l1"></i><i class="hm l2"></i><i class="hm l3"></i><i class="hm l4"></i> More <span style="margin-left:14px"><i class="hm l2 met"></i> goals met</span></div>`;
}

function timeBlock(r) {
  const week = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(r.today + "T12:00:00"); d.setDate(d.getDate() - i); week.push([ymd(d), d]); }
  const max = Math.max(...week.map(([k]) => sumTime(r.days[k]?.time)), 1);
  const tToday = r.days[r.today]?.time || {};
  const total = sumTime(tToday);
  const bars = week.map(([k, d]) => {
    const t = r.days[k]?.time || {};
    const segs = KINDS.filter(([id]) => t[id]).map(([id, l, c]) => `<i style="height:${(100 * t[id]) / max}%;background:${c}" data-tip="${l}: ${mins(t[id])} min"></i>`).join("");
    return `<div class="tb"><div class="tb-bar">${segs}</div><span>${d.toLocaleDateString(undefined, { weekday: "narrow" })}</span><b>${mins(sumTime(t)) || ""}</b></div>`;
  }).join("");
  const split = total ? KINDS.filter(([id]) => tToday[id]).sort((a, b) => tToday[b[0]] - tToday[a[0]]).map(([id, l, c]) =>
    `<div class="ts"><i style="background:${c}"></i>${l}<b>${mins(tToday[id])} min</b><span>${Math.round((100 * tToday[id]) / total)}%</span></div>`).join("") : `<div class="muted">Nothing tracked yet today. Time counts only while a LinkedIn tab is in front and you're using it.</div>`;
  const v = r.days[r.today] || {};
  const perHour = total ? (((v.reach || 0) + (v.follow || 0)) / (total / 3600)).toFixed(1) : null;
  return `<div class="card"><h2>Time on LinkedIn · today ${mins(total)} min</h2>
    <div class="time-wrap"><div class="tbs">${bars}</div><div class="tsplit">${split}
    ${perHour ? `<div class="tk" data-tip="People reached out to or followed up, per hour on LinkedIn today">${perHour} people per hour</div>` : ""}</div></div></div>`;
}

function renderToday() {
  const r = rhythm;
  if (!r) { $("main").innerHTML = `<div class="card empty">Loading…</div>`; return; }
  const t = r.days[r.today] || { reach: 0, follow: 0, review: 0 };
  const g = r.goals;
  const s = streaks(r.days, g, r.today);
  const c = coach(r, t);
  const reachList = r.toReach.slice(0, Math.max(g.reach - t.reach, 0) || 3);
  const goalCard = (key, label, color, sub, body) => `<div class="goal"><div class="goal-top">${ring(t[key] || 0, g[key], color)}<div><div class="goal-l">${label}</div><div class="goal-s">${sub}</div>
      ${editingGoals ? `<label class="goal-e">Daily goal <input type="number" min="0" max="100" data-goal="${key}" value="${g[key]}"></label>` : ""}</div></div>${body}</div>`;
  const person = (p, href, extra) => `<a class="np" href="${esc(href)}" target="_blank" rel="noopener"><b>${esc(p.name)}</b><span>${esc(extra)}</span></a>`;
  $("main").innerHTML = `
    <div class="today-head">
      <div class="streak ${s.cur ? "on" : ""}" data-tip="Days in a row you met both goals: reach out to ${g.reach} and follow up with ${g.follow}. Today counts once you meet them.">
        <b>${s.cur}</b><span>day streak${s.best > s.cur ? ` · best ${s.best}` : ""}</span></div>
      <div class="coach"><div class="coach-l">Do this next</div><div class="coach-t">${esc(c.text)}</div>
        ${c.href ? `<a class="btn primary" href="${esc(c.href)}" target="_blank" rel="noopener">${esc(c.label)} ↗</a>` : c.go ? `<button class="btn primary" data-go="${c.go}">${esc(c.label)}</button>` : ""}</div>
    </div>
    <div class="goals">
      ${goalCard("reach", "Reach out to new people", "#5e5ce6", `${t.reach} of ${g.reach} today`,
        reachList.length ? `<div class="np-h">Next up</div>${reachList.map((p) => person(p, p.linkedin, [p.icp, p.why || p.company].filter(Boolean).join(" · "))).join("")}` : `<div class="muted small">No leads ready. Keep people in Review to fill this.</div>`)}
      ${goalCard("follow", "Follow up", "#34c759", `${t.follow} of ${g.follow} today · ${r.due.length} due`,
        r.due.length ? `<div class="np-h">Due</div>${r.due.slice(0, 4).map((d) => person(d, d.linkedin || d.appUrl, `due ${d.at}${d.note ? " · " + d.note : ""}`)).join("")}` : `<div class="muted small">Nobody is due.</div>`)}
      ${goalCard("review", "Review suggestions", "#ff9f0a", `${t.review} of ${g.review} today · ${r.toReview} waiting`,
        r.toReview ? `<button class="btn" data-go="review" style="margin-top:10px">Review ${r.toReview} waiting</button>` : `<div class="muted small">Nothing waiting. Ask Claude for a new batch.</div>`)}
    </div>
    <div class="row-actions" style="justify-content:flex-end;margin:-6px 0 14px">${editingGoals ? `<button class="btn primary" id="saveGoals">Save goals</button>` : `<button class="btn" id="editGoals">Edit daily goals</button>`}</div>
    <div class="card" style="margin-bottom:16px"><h2>Your days · last 12 months</h2>${heatmap(r)}</div>
    ${timeBlock(r)}`;
  document.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => { page = "people"; tab = "review"; renderPage(); });
  $("editGoals")?.addEventListener("click", () => { editingGoals = true; renderToday(); });
  $("saveGoals")?.addEventListener("click", async () => {
    const goals = { ...r.goals };
    document.querySelectorAll("[data-goal]").forEach((i) => { goals[i.dataset.goal] = Math.max(0, Number(i.value) || 0); });
    await send("setGoals", { goals });
    r.goals = goals; editingGoals = false; renderToday();
  });
}

// ── Pages: Today | People ──
let page = location.hash === "#posts" ? "posts" : location.hash.slice(1) === "today" || !location.hash ? "today" : "people";
function renderPage() {
  document.querySelectorAll("[data-page]").forEach((b) => b.classList.toggle("on", b.dataset.page === page));
  $("icps").hidden = page !== "people";
  document.querySelector(".more-filters").hidden = page !== "people";
  if (page === "today") {
    if (location.hash !== "#today") history.replaceState(null, "", "#today");
    renderToday();
  } else if (page === "posts") {
    if (location.hash !== "#posts") history.replaceState(null, "", "#posts");
    loadPosts().then(renderPosts);
  } else render();
}
document.querySelectorAll("[data-page]").forEach((b) => b.onclick = () => {
  page = b.dataset.page;
  if (page === "people" && /^#(today|posts)$/.test(location.hash)) history.replaceState(null, "", location.pathname);
  if (page === "people") filter = decodeURIComponent(location.hash.slice(1));
  renderPage();
});
renderPage();
send("rhythm").then((r) => { if (r?.ok) rhythm = r.data; else rhythm = null; if (page === "today") r?.ok ? renderToday() : ($("main").innerHTML = `<div class="card empty err">${esc(r?.error || "Could not load")}</div>`); });

// ── Posts: saved from the feed, reviewed by Claude ──
let posts = [];
const reviewing = new Set();
async function loadPosts() { const r = await send("posts"); posts = r?.ok ? r.data : []; }
function postCard(p) {
  const rv = p.review;
  const icp = rv && icpOf(rv.icp);
  const busy = reviewing.has(p.id);
  return `<div class="post" data-id="${esc(p.id)}">
    <div class="post-h"><div><a class="post-a" href="${esc(p.author.url || p.pageUrl)}" target="_blank" rel="noopener">${esc(p.author.name || "Unknown")}</a>
      <div class="post-hl">${esc(p.author.headline || "")}</div></div>
      <span class="muted post-d">saved ${new Date(p.savedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span></div>
    <div class="post-t" dir="auto">${esc(p.text)}</div>
    ${p.text.length > 420 ? `<button class="link-btn" data-more>Show all</button>` : ""}
    ${rv ? `<div class="rv-box">
        <div class="rv-top2">${icp ? `<span class="icp-badge">ICP ${icp.rank} · ${esc(icp.name)}</span>` : `<span class="icp-badge none">No ICP</span>`}<span class="fit-s" data-tip="How well the author fits, 0-10, judged by Claude from the post">${rv.fit}/10</span></div>
        <div class="rv-sum">${esc(rv.summary)}</div>
        <div class="rv-k">Why it matters</div><div>${esc(rv.why)}</div>
        ${rv.comment ? `<div class="rv-k">Comment you could leave <button class="copy" data-copy="${esc(rv.comment)}">Copy</button></div><div class="quote">${esc(rv.comment)}</div>` : ""}
        ${rv.message ? `<div class="rv-k">First message <button class="copy" data-copy="${esc(rv.message)}">Copy</button></div><div class="quote">${esc(rv.message)}</div>` : ""}
      </div>` : ""}
    <div class="post-act">
      <button class="btn ${rv ? "" : "primary"}" data-review ${busy ? "disabled" : ""}>${busy ? "Claude is reading…" : rv ? "Review again" : "Review with Claude"}</button>
      ${p.contactId ? `<span class="muted">In Contacts ✓</span>` : /linkedin\.com\/in\//.test(p.author.url || "") ? `<button class="btn" data-add data-tip="Adds the author to Contacts with the post and Claude's reason, tagged with the ICP">Add author to Contacts</button>` : ""}
      <a class="btn" href="${esc(p.pageUrl)}" target="_blank" rel="noopener" data-tip="The page you saved it from">Source ↗</a>
      <button class="btn danger" data-del>Remove</button>
    </div>
    <div class="post-err err"></div>
  </div>`;
}
function renderPosts() {
  const todo = posts.filter((p) => !p.review).length;
  const sorted = [...posts].sort((a, b) => (b.review?.fit ?? -1) - (a.review?.fit ?? -1) || b.savedAt.localeCompare(a.savedAt));
  $("main").innerHTML = posts.length ? `
    <div class="posts-head"><div><b>${posts.length} saved post${posts.length === 1 ? "" : "s"}</b>${todo ? ` · ${todo} not reviewed` : ""} <span class="muted">· best fit first</span></div>
      <div class="row-actions" style="margin:0">${todo ? `<button class="btn primary" id="reviewAll">Review ${todo} with Claude</button>` : ""}<button class="btn" id="copyAll" data-tip="Copies every saved post as text, to paste into Claude Code">Copy all for Claude Code</button></div></div>
    <div class="posts">${sorted.map(postCard).join("")}</div>`
    : `<div class="card empty"><b>No saved posts yet.</b><br>In your LinkedIn feed, press <b>☆ Save post</b> under any post. It shows up here, and Claude tells you if the author fits an ICP and what to say.</div>`;
  document.querySelectorAll(".post").forEach((el) => {
    const id = el.dataset.id;
    const err = (m) => { el.querySelector(".post-err").textContent = m; };
    el.querySelector("[data-more]")?.addEventListener("click", (e) => { el.querySelector(".post-t").classList.add("open"); e.target.remove(); });
    el.querySelector("[data-review]")?.addEventListener("click", () => review1(id).then(renderPosts, () => {}));
    el.querySelector("[data-add]")?.addEventListener("click", async () => {
      const r = await send("postAuthorToContacts", { id });
      if (!r?.ok) return err(r?.error || "Could not add");
      await loadPosts(); renderPosts();
    });
    el.querySelector("[data-del]")?.addEventListener("click", async () => { await send("unsavePost", { id }); await loadPosts(); renderPosts(); });
    el.querySelectorAll("[data-copy]").forEach((b) => b.onclick = async () => { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied"; });
  });
  $("reviewAll")?.addEventListener("click", async () => {
    try { for (const p of posts.filter((x) => !x.review)) { await review1(p.id); renderPosts(); } } catch { /* stopped on the first error, shown on that post */ }
  });
  $("copyAll")?.addEventListener("click", async () => {
    const md = posts.map((p) => `## ${p.author.name}${p.author.headline ? " · " + p.author.headline : ""}\n${p.author.url || ""}\nSaved ${p.savedAt.slice(0, 10)} from ${p.pageUrl}\n\n${p.text}${p.review ? `\n\nClaude: ${p.review.icp} ${p.review.fit}/10. ${p.review.why}` : ""}`).join("\n\n---\n\n");
    await navigator.clipboard.writeText(`Saved LinkedIn posts (${posts.length}). Review them against my ICPs and tell me who to reach out to and what to say.\n\n${md}`);
    $("copyAll").textContent = "Copied";
  });
}
async function review1(id) {
  reviewing.add(id); renderPosts();
  const r = await send("reviewPost", { id });
  reviewing.delete(id);
  if (!r?.ok) { await loadPosts(); renderPosts(); const el = document.querySelector(`.post[data-id="${CSS.escape(id)}"] .post-err`); if (el) el.innerHTML = esc(r?.error || "Review failed") + (/API key/.test(r?.error || "") ? ` <a href="options.html" target="_blank">Open settings</a>` : ""); throw new Error("stop"); }
  await loadPosts();
}
chrome.storage?.onChanged?.addListener((ch) => { if (ch.posts && page === "posts") { posts = ch.posts.newValue || []; if (!reviewing.size) renderPosts(); } });
