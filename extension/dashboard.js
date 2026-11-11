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
const PAGES = ["today", "pick", "reach", "follow", "results", "visibility", "offers"];
const hash0 = decodeURIComponent(location.hash.slice(1));
// An old link to a campaign (#name) opens Results filtered to it; #posts opens Pick → saved posts.
let filter = hash0 && !PAGES.includes(hash0) && hash0 !== "posts" ? hash0 : "";

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
  if (!$("filters")) return;
  const none = data.people.filter((p) => !p.groups.length).length;
  const chips = [{ v: "", label: "Everyone", n: data.people.filter((p) => !p.suggested).length },
    ...ICPS.map((i) => ({ v: "icp:" + i.id, label: i.short, n: data.people.filter((p) => !p.suggested && (p.icps || []).includes(i.id)).length })).filter((c) => c.n),
    ...campaigns().map((c) => ({ v: c.name, label: c.name, n: c.n }))];
  if (none) chips.push({ v: NONE, label: "No campaign or list", n: none });
  $("filters").innerHTML = chips.map((c) => `<button class="chip ${c.v === filter ? "on" : ""}" data-v="${esc(c.v)}">${esc(c.label)}<span class="n">${c.n}</span></button>`).join("");
  $("filters").querySelectorAll(".chip").forEach((b) => b.onclick = () => setFilter(b.dataset.v));
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
  if (!list.length) return `<div class="card empty"><b>Nobody left to pick here.</b><br>The people you kept are waiting in <a href="#reach" data-goto="reach">step 2, Reach out</a>.</div>`;
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
        ${score ? `<div class="fit" data-tip="${esc("Claude's estimate of fit, out of 25: need, no infra of their own, can adopt, reachable, could pay within 90 days.\n" + n.fit)}"><b>${score}</b><span>/25</span></div>` : ""}
      </div>
      ${(p.icps || []).map((id) => icpOf(id) ? `<div class="icp-badge" data-tip="${esc(icpOf(id).person)}">${esc(icpOf(id).short)}</div>` : "").join(" ")}
      ${n.evidence ? `<div class="fc-row"><span>What we found</span><div class="fc-why" style="margin:2px 0 0">${esc(n.evidence)}</div></div>` : n.why ? `<div class="fc-why">${esc(n.why)}</div>` : ""}
      ${n.source ? `<div class="fc-row"><span>Source</span>${linkify(n.source)}</div>` : ""}
      ${n.useCase ? `<div class="fc-row"><span>What they build</span>${esc(n.useCase)}</div>` : ""}
      ${n.evidence && n.why ? `<div class="fc-row"><span>Angle you could try <i data-tip="Claude's guess from the evidence above, not something they said">(Claude's guess)</i></span>${esc(n.why)}</div>` : ""}
      ${n.other.length ? `<details class="fc-more"><summary>More notes</summary>${n.other.map((l) => `<p>${linkify(l)}</p>`).join("")}</details>` : ""}
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

// ── Step pages ──
let who = "";          // "" or an ICP id: narrows Pick and Reach out
let pickSrc = hash0 === "posts" ? "posts" : "people"; // Pick from Claude's suggestions or from saved posts
const stepHead = (n, title, what, then) => `<div class="stephead"><div class="big-n">${n}</div><div><h2>${title}</h2><p>${what}</p>${then ? `<p class="then">${then}</p>` : ""}</div></div>`;
const icpRank = (p) => Math.min(...(p.icps || []).map((id) => icpOf(id)?.rank || 9), 9);
const label = (p) => (p.icps || []).map((id) => icpOf(id)?.short).filter(Boolean)[0] || "";
const toPick = () => data.people.filter((p) => p.suggested);
const toReachList = () => data.people.filter((p) => !p.suggested && !p.lost && p.level === 0).sort((a, b) => icpRank(a) - icpRank(b));
const waiting = () => data.people.filter((p) => !p.lost && p.level === 1);
const accepted = () => data.people.filter((p) => !p.lost && p.level === 2);
const repliedL = () => data.people.filter((p) => !p.lost && p.level === 3);
const dueL = () => rhythm?.due || [];
function whoChips(list) {
  const counts = ICPS.map((i) => ({ i, n: list.filter((p) => (p.icps || []).includes(i.id)).length })).filter((x) => x.n);
  if (!counts.length) return "";
  const icp = who && icpOf(who);
  return `<div class="who"><button class="${who ? "" : "on"}" data-who="">Everyone<span>${list.length}</span></button>${counts.map(({ i, n }) => `<button class="${who === i.id ? "on" : ""}" data-who="${i.id}" data-tip="${esc(i.person)}">${esc(i.short)}<span>${n}</span></button>`).join("")}</div>
    ${icp ? `<div class="who-line"><b>Who this is:</b> ${esc(icp.person)} <a href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(icp.find)}" target="_blank" rel="noopener">Find more on LinkedIn ↗</a></div>` : ""}`;
}
const byWho = (list) => (who ? list.filter((p) => (p.icps || []).includes(who)) : list);
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function counts() {
  const n = { pick: toPick().length, reach: toReachList().length, follow: dueL().length + accepted().length + repliedL().length };
  for (const k in n) { const el = $("n-" + k); if (el) el.textContent = n[k] || ""; }
}

function renderPick() {
  const all = toPick();
  const src = `<div class="src"><button class="${pickSrc === "people" ? "on" : ""}" data-src="people">People Claude found · ${all.length}</button><button class="${pickSrc === "posts" ? "on" : ""}" data-src="posts"><svg width="13" height="13" viewBox="0 0 24 24" style="vertical-align:-2px"><path d="M6.5 3.5h11a1 1 0 0 1 1 1v16.2l-6.5-4.4-6.5 4.4V4.5a1 1 0 0 1 1-1z" fill="currentColor"/></svg> Bookmarked · ${posts.length}</button></div>`;
  if (pickSrc === "posts") {
    $("main").innerHTML = stepHead(1, "Pick people", "Posts you saved in the feed. Claude reads each one and says if the author is someone you're looking for.", "<b>Then:</b> press <b>Add author</b> on a good one. They go to step 2.") + src + `<div id="postsBox"></div>`;
    renderPosts();
  } else {
    $("main").innerHTML = stepHead(1, "Pick people", "Claude found these people. For each one, decide: worth contacting, or not.", "<b>Then:</b> everyone you keep goes to step 2, Reach out.") + src + whoChips(all) + review(byWho(all));
  }
  wireStep();
  document.querySelectorAll("[data-keep], [data-skip]").forEach((b) => b.onclick = () => decide(b.dataset.keep || b.dataset.skip, Boolean(b.dataset.keep)));
  $("prev")?.addEventListener("click", () => { reviewAt--; renderPick(); });
  $("next")?.addEventListener("click", () => { reviewAt++; renderPick(); });
}

const leadRow = (p, acts, extra = "") => `<div class="lead" data-id="${esc(p.id)}"><div class="info">
    <a class="nm" href="${esc(profileLink(p))}" target="_blank" rel="noopener">${esc(p.name)}</a>
    ${p.title || p.company ? `<div class="rl">${esc([p.title, p.company].filter(Boolean).join(" · "))}</div>` : ""}
    ${p.why ? `<div class="wh">${esc(p.why)}</div>` : ""}${extra}
    ${label(p) ? `<span class="lbl2">${esc(label(p))}</span>` : ""}</div><div class="acts">${acts}</div></div>`;

let reachShown = 10;
function renderReach() {
  const all = toReachList();
  const list = byWho(all);
  const w = waiting();
  $("main").innerHTML = stepHead(2, "Reach out", "Send each person a connection request. Press <b>Open LinkedIn</b>, then Connect. The extension's panel asks why, can write the note for you, and records it.", "<b>Then:</b> they wait here until they accept. Once they do, they go to step 3.")
    + whoChips(all)
    + (list.length ? `<div class="lead-list">${list.slice(0, reachShown).map((p) => leadRow(p, `<a class="btn primary" href="${esc(profileLink(p))}" target="_blank" rel="noopener">Open LinkedIn ↗</a><button class="btn" data-asked="${esc(p.id)}" data-tip="You already sent the request yourself: mark it">Sent ✓</button><button class="btn" data-nofit="${esc(p.id)}" data-tip="Remove from the list">Not a fit</button>`)).join("")}</div>`
      + (list.length > reachShown ? `<div class="row-actions"><button class="btn" id="more">Show 10 more · ${list.length - reachShown} left</button></div>` : "")
      : `<div class="card empty"><b>Nobody to reach out to.</b><br>Keep people in <a href="#pick" data-goto="pick">step 1, Pick</a> first.</div>`)
    + (w.length ? `<div class="sect">Asked, waiting for them to accept · ${w.length}</div><div class="lead-list">${w.map((p) => leadRow(p, `<a class="btn" href="${esc(profileLink(p))}" target="_blank" rel="noopener">LinkedIn ↗</a>`)).join("")}</div>` : "");
  wireStep();
  $("more")?.addEventListener("click", () => { reachShown += 10; renderReach(); });
  document.querySelectorAll("[data-asked]").forEach((b) => b.onclick = async () => {
    const id = b.dataset.asked; b.closest(".lead").classList.add("gone");
    const r = await send("markAsked", { id });
    if (!r?.ok) { b.closest(".lead").classList.remove("gone"); return toast(r?.error || "Could not save"); }
    const p = data.people.find((x) => x.id === id); p.level = 1; p.stage = "contacted";
    toast("Marked as asked. When they accept, they show up in step 3."); renderReach(); counts();
  });
  document.querySelectorAll("[data-nofit]").forEach((b) => b.onclick = async () => {
    const id = b.dataset.nofit; b.closest(".lead").classList.add("gone");
    await send("review", { id, keep: false });
    data.people = data.people.filter((x) => x.id !== id); renderReach(); counts();
  });
}

function renderFollow() {
  const due = dueL(), acc = accepted().filter((p) => !due.some((d) => d.id === p.id)), rep = repliedL();
  const dueRow = (d) => leadRow({ ...d, linkedin: d.linkedin }, `<a class="btn primary" href="${esc(d.linkedin || d.appUrl)}" target="_blank" rel="noopener">Open ↗</a><button class="btn" data-done="${esc(d.id)}" data-tip="You followed up: clear the reminder">Done ✓</button><button class="btn" data-snooze="${esc(d.id)}" data-tip="Remind me in 3 days">Later</button>`,
    `<div class="rl">${d.note ? esc(d.note) + " · " : ""}due ${esc(d.at)}${d.nudges?.count ? ` · you've reached out ${d.nudges.count}×` : ""}</div>`);
  $("main").innerHTML = stepHead(3, "Follow up", "These people accepted, wrote back, or are due a nudge. Open them and send a message on LinkedIn. The extension records it.", "<b>Then:</b> when someone agrees to talk, set their stage to <b>call</b> in the panel. You can see it in Results.")
    + (rep.length ? `<div class="sect">They wrote back: answer them · ${rep.length}</div><div class="lead-list">${rep.map((p) => leadRow(p, `<a class="btn primary" href="${esc(profileLink(p))}" target="_blank" rel="noopener">Open ↗</a>`)).join("")}</div>` : "")
    + (due.length ? `<div class="sect">Due for a nudge · ${due.length}</div><div class="lead-list">${due.map(dueRow).join("")}</div>` : "")
    + (acc.length ? `<div class="sect">Accepted: send a first message · ${acc.length}</div><div class="lead-list">${acc.map((p) => leadRow(p, `<a class="btn primary" href="${esc(profileLink(p))}" target="_blank" rel="noopener">Open ↗</a>`)).join("")}</div>` : "")
    + (!rep.length && !due.length && !acc.length ? `<div class="card empty"><b>Nobody to follow up with today.</b><br>People appear here once they accept your request in <a href="#reach" data-goto="reach">step 2</a>.</div>` : "");
  wireStep();
  const act = (sel, type, extra) => document.querySelectorAll(sel).forEach((b) => b.onclick = async () => {
    const id = b.dataset[type === "done" ? "done" : "snooze"]; b.closest(".lead").classList.add("gone");
    await send(type, { id, ...extra });
    rhythm.due = rhythm.due.filter((d) => d.id !== id); renderFollow(); counts();
  });
  act("[data-done]", "done", {}); act("[data-snooze]", "snooze", { days: 3 });
}

function wireStep() {
  document.querySelectorAll("[data-who]").forEach((b) => b.onclick = () => { who = b.dataset.who; reviewAt = 0; renderPage(); });
  document.querySelectorAll("[data-src]").forEach((b) => b.onclick = () => { pickSrc = b.dataset.src; if (pickSrc === "posts") loadPosts().then(renderPick); else renderPick(); });
  document.querySelectorAll("[data-goto]").forEach((a) => a.onclick = (e) => { e.preventDefault(); go(a.dataset.goto); });
}

// ── Results: the funnel, campaigns and lists, everyone by step ──
function render() {
  if (page !== "results") return;
  const list = data.people.filter((p) => inView(p) && !p.suggested);
  const real = filter && filter !== NONE && !filter.startsWith("icp:");
  const icp = filter.startsWith("icp:") ? icpOf(filter.slice(4)) : null;
  $("main").innerHTML = `<div class="filters" id="filters" style="margin-bottom:16px"></div><div class="grid">
    <div class="card"><h2>How far people got · ${esc(icp ? icp.short : !filter ? "everyone" : filter === NONE ? "no campaign or list" : filter)}</h2>${funnel(list)}</div>
    <div class="card"><h2>By campaign or list</h2>${table()}</div>
    ${real ? `<div class="card full"><h2>What ${esc(filter)} is about</h2>
      <textarea id="pitch" placeholder="Used when drafting notes and messages for people in this campaign.">${esc(data.pitches[filter] || "")}</textarea>
      <div class="row-actions"><button class="btn" id="savePitch">Save</button>${(data.listNames || []).includes(filter) ? "" : `<button class="btn" id="toList" data-tip="Creates a list named ${esc(filter)} in the Contacts app with everyone in it">Make a list in Contacts</button>`}<span id="msg"></span></div></div>` : ""}
    <div class="card full"><h2>People · ${list.length}</h2>${people(list)}</div>
  </div>`;
  renderFilters();
  document.querySelectorAll("tr.row").forEach((tr) => tr.onclick = () => setFilter(tr.dataset.v));
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
  if (keep) { p.suggested = false; p.stage = p.stage || "lead"; p.level = 0; toast(`Kept ${p.name.split(/[ ;,]/)[0]}. They're in step 2, Reach out.`); } else data.people = data.people.filter((x) => x.id !== id);
  counts();
  renderPick(); // the next person slides into the same position
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
  counts();
  renderPage();
}

$("reload").onclick = async () => { await load(true); const r = await send("rhythm"); if (r?.ok) { rhythm = r.data; counts(); renderPage(); } };
addEventListener("hashchange", () => { const h = location.hash.slice(1); if (PAGES.includes(h) && h !== page) { page = h; renderPage(); } });

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
  if (reachLeft && !r.toReach.length && r.toReview) return { text: `You have no leads ready. Review suggestions first: ${r.toReview} waiting.`, go: "pick", label: "Go to step 1, Pick" };
  if (followLeft && r.due.length) return { text: `Follow up with ${r.due[0].name} first. ${r.due.length} follow-up${r.due.length === 1 ? " is" : "s are"} waiting, the oldest since ${r.due[0].at}.`, href: r.due[0].linkedin || r.due[0].appUrl, label: `Open ${r.due[0].name.split(" ")[0]}` };
  if (reachLeft && r.toReach.length) return { text: `Reach out to ${reachLeft} more ${reachLeft === 1 ? "person" : "people"} today. Start with ${r.toReach[0].name}${r.toReach[0].company ? ` (${r.toReach[0].company})` : ""}.`, href: r.toReach[0].linkedin, label: `Open ${r.toReach[0].name.split(" ")[0]}` };
  if (total > 600 && feed / total > 0.5) return { text: `${mins(feed)} of your ${mins(total)} minutes today went to the feed. Goals are done, so close LinkedIn.` };
  if (!reachLeft && !followLeft) return { text: "Today's goals are done. Close LinkedIn, or review suggestions for tomorrow.", go: r.toReview ? "pick" : null, label: "Pick people for tomorrow" };
  return { text: "Pick people to contact: Claude's suggestions, or posts you saved.", go: "pick", label: "Go to step 1, Pick" };
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
  const goalCard = (key, label, color, sub, body, n) => `<div class="goal stepcard"><div class="goal-top">${ring(t[key] || 0, g[key], color)}<div><div class="goal-l" data-n="${n}">${label}</div><div class="goal-s">${sub}</div>
      ${editingGoals ? `<label class="goal-e">Daily goal <input type="number" min="0" max="100" data-goal="${key}" value="${g[key]}"></label>` : ""}</div></div>${body}</div>`;
  const person = (p, href, extra) => `<a class="np" href="${esc(href)}" target="_blank" rel="noopener"><b>${esc(p.name)}</b><span>${esc(extra)}</span></a>`;
  $("main").innerHTML = `
    <div class="today-head">
      <div class="streak ${s.cur ? "on" : ""}" data-tip="Days in a row you met both goals: reach out to ${g.reach} and follow up with ${g.follow}. Today counts once you meet them.">
        <b>${s.cur}</b><span>day streak${s.best > s.cur ? ` · best ${s.best}` : ""}</span></div>
      <div class="coach"><div class="coach-l">Do this next</div><div class="coach-t">${esc(c.text)}</div>
        ${c.href ? `<a class="btn primary" href="${esc(c.href)}" target="_blank" rel="noopener">${esc(c.label)} ↗</a>` : c.go ? `<button class="btn primary" data-go="${c.go}">${esc(c.label)}</button>` : ""}</div>
    </div>
    <div class="habit">${ring(t.comment || 0, g.comment ?? 3, "#30b0c7")}<div class="ht"><b>Every day: comment on ${g.comment ?? 3} relevant posts</b>
      <div>In your feed, posts about your topics are marked <b>💬 Relevant</b>. A real comment there puts your name in front of the people you want. ${t.comment || 0} today.</div></div>
      <a class="btn" href="https://www.linkedin.com/feed/" target="_blank" rel="noopener">Open the feed ↗</a><button class="btn" data-go="visibility">Visibility ›</button>${editingGoals ? `<label class="goal-e">Daily goal <input type="number" min="0" max="100" data-goal="comment" value="${g.comment ?? 3}"></label>` : ""}</div>
    <div class="goals">
      ${goalCard("review", "Pick people", "#ff9f0a", `${t.review} of ${g.review} today · ${r.toReview} waiting`,
        `<div class="muted small" style="margin-top:8px">Keep or skip the people Claude found.</div><button class="btn" data-go="pick" style="margin-top:10px">Go to step 1 ›</button>`, 1)}
      ${goalCard("reach", "Reach out", "#5e5ce6", `${t.reach} of ${g.reach} today · ${toReachList().length || r.toReach.length} ready`,
        (reachList.length ? `<div class="np-h">Next up</div>${reachList.map((p) => person(p, p.linkedin, p.why || p.company || "")).join("")}` : `<div class="muted small">Nobody ready. Pick people in step 1.</div>`) + `<button class="btn" data-go="reach" style="margin-top:10px">Go to step 2 ›</button>`, 2)}
      ${goalCard("follow", "Follow up", "#34c759", `${t.follow} of ${g.follow} today · ${r.due.length} due`,
        (r.due.length ? `<div class="np-h">Due</div>${r.due.slice(0, 3).map((d) => person(d, d.linkedin || d.appUrl, d.note || `due ${d.at}`)).join("")}` : `<div class="muted small">Nobody is due.</div>`) + `<button class="btn" data-go="follow" style="margin-top:10px">Go to step 3 ›</button>`, 3)}
    </div>
    <div class="row-actions" style="justify-content:flex-end;margin:-6px 0 14px">${editingGoals ? `<button class="btn primary" id="saveGoals">Save goals</button>` : `<button class="btn" id="editGoals">Edit daily goals</button>`}</div>
    <div class="card" style="margin-bottom:16px"><h2>Your days · last 12 months</h2>${heatmap(r)}</div>
    ${timeBlock(r)}`;
  document.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => go(b.dataset.go));
  $("editGoals")?.addEventListener("click", () => { editingGoals = true; renderToday(); });
  $("saveGoals")?.addEventListener("click", async () => {
    const goals = { ...r.goals };
    document.querySelectorAll("[data-goal]").forEach((i) => { goals[i.dataset.goal] = Math.max(0, Number(i.value) || 0); });
    await send("setGoals", { goals });
    r.goals = goals; editingGoals = false; renderToday();
  });
}

// ── Pages: Today · 1 Pick · 2 Reach out · 3 Follow up · Results ──
let page = PAGES.includes(hash0) ? hash0 : hash0 === "posts" ? "pick" : hash0 ? "results" : "today";
function go(p) { page = p; renderPage(); scrollTo(0, 0); }
function renderPage() {
  document.querySelectorAll("[data-page]").forEach((b) => b.classList.toggle("on", b.dataset.page === page));
  if (location.hash !== "#" + page) history.replaceState(null, "", "#" + page);
  if (page === "today") return renderToday();
  if (!data.people.length && !rhythm) { $("main").innerHTML = `<div class="card empty">Loading…</div>`; return; }
  if (page === "pick") return pickSrc === "posts" ? loadPosts().then(renderPick) : renderPick();
  if (page === "reach") return renderReach();
  if (page === "follow") return renderFollow();
  if (page === "visibility") return renderVisibility();
  if (page === "offers") return renderOffers();
  render();
}


// ── Posts: saved from the feed, reviewed by Claude ──
let posts = [];
const reviewing = new Set();
const postHref = (p) => p.url || (/linkedin\.com\/(in|company)\//.test(p.author?.url || "") ? p.author.url.replace(/\/?$/, "/") + (p.author.url.includes("/company/") ? "posts/" : "recent-activity/all/") : p.pageUrl);
async function loadPosts() { const r = await send("posts"); posts = r?.ok ? r.data : []; }
function postCard(p) {
  const rv = p.review;
  const icp = rv && icpOf(rv.icp);
  const busy = reviewing.has(p.id);
  return `<div class="post" data-id="${esc(p.id)}">
    <div class="post-h"><div><a class="post-a" href="${esc(postHref(p))}" target="_blank" rel="noopener">${esc(p.author.name || "Unknown")}</a>
      <div class="post-hl">${esc(p.author.headline || "")}</div></div>
      <span class="muted post-d">saved ${new Date(p.savedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span></div>
    <div class="post-t" dir="auto">${esc(p.text)}</div>
    ${p.text.length > 420 ? `<button class="link-btn" data-more>Show all</button>` : ""}
    ${rv ? `<div class="rv-box">
        <div class="rv-top2">${icp ? `<span class="icp-badge">${esc(icp.short)}</span>` : `<span class="icp-badge none">Not who you're looking for</span>`}<span class="fit-s" data-tip="How well the author fits, 0-10, judged by Claude from the post">${rv.fit}/10</span></div>
        <div class="rv-sum">${esc(rv.summary)}</div>
        <div class="rv-k">Why it matters</div><div>${esc(rv.why)}</div>
        ${rv.comment ? `<div class="rv-k">Comment you could leave <button class="copy" data-copy="${esc(rv.comment)}">Copy</button></div><div class="quote">${esc(rv.comment)}</div>` : ""}
        ${rv.message ? `<div class="rv-k">First message <button class="copy" data-copy="${esc(rv.message)}">Copy</button></div><div class="quote">${esc(rv.message)}</div>` : ""}
      </div>` : ""}
    <div class="post-act">
      <button class="btn ${rv ? "" : "primary"}" data-review ${busy ? "disabled" : ""}>${busy ? "Claude is reading…" : rv ? "Review again" : "Review with Claude"}</button>
      ${p.contactId ? `<span class="muted">In Contacts ✓</span>` : /linkedin\.com\/in\//.test(p.author.url || "") ? `<button class="btn primary" data-add data-tip="Adds the author to Contacts. They go to step 2, Reach out.">Add author → step 2</button>` : ""}
      <a class="btn" href="${esc(postHref(p))}" target="_blank" rel="noopener" data-tip="${p.url ? "Open the post on LinkedIn" : "Bookmarked before links were kept: opens the author's recent posts"}">Open post ↗</a>
      <button class="btn danger" data-del>Remove</button>
    </div>
    <div class="post-err err"></div>
  </div>`;
}
function renderPosts() {
  const todo = posts.filter((p) => !p.review).length;
  const sorted = [...posts].sort((a, b) => (b.review?.fit ?? -1) - (a.review?.fit ?? -1) || b.savedAt.localeCompare(a.savedAt));
  const box = $("postsBox");
  if (!box) return;
  box.innerHTML = posts.length ? `
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
      await loadPosts(); renderPosts(); toast("Added. They're in step 2, Reach out."); load();
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
chrome.storage?.onChanged?.addListener((ch) => { if (ch.posts && page === "pick" && pickSrc === "posts") { posts = ch.posts.newValue || []; if (!reviewing.size) renderPosts(); } });


// ── Visibility: your comments and how many people saw them ──
let vis = null;
async function renderVisibility() {
  if (!vis) { $("main").innerHTML = `<div class="card empty">Loading…</div>`; const r = await send("visibility"); vis = r?.ok ? r.data : { comments: [], snapshots: {} }; if (page !== "visibility") return; }
  const { comments, snapshots } = vis;
  const days = Object.keys(snapshots).sort();
  const last = days.length ? snapshots[days.at(-1)] : null;
  const first = days.length > 1 ? snapshots[days[0]] : null;
  const delta = (k) => { if (!first || last?.[k] == null || first[k] == null) return ""; const d = last[k] - first[k]; return d ? `<em class="${d > 0 ? "up" : "down"}">${d > 0 ? "+" : ""}${d.toLocaleString()} since ${new Date(days[0]).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</em>` : ""; };
  const k = (v, label, key, tip) => `<div class="k" data-tip="${esc(tip)}"><b>${v == null ? "–" : v.toLocaleString()}</b><span>${label}</span>${key ? delta(key) : ""}</div>`;
  const wkStart = (iso) => { const d = new Date(iso); d.setHours(12); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
  const weeks = [];
  for (let i = 7; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - 7 * i); weeks.push(wkStart(d.toISOString())); }
  const per = weeks.map((w) => { const l = comments.filter((c) => wkStart(c.at) === w); return { w, n: l.length, imp: l.reduce((a, c) => a + (c.impressions || 0), 0) }; });
  const maxN = Math.max(...per.map((x) => x.n), 1);
  const thisWeek = per.at(-1);
  const totalImp = comments.reduce((a, c) => a + (c.impressions || 0), 0);
  const avg = comments.filter((c) => c.checkedAt).length ? Math.round(totalImp / comments.filter((c) => c.checkedAt).length) : null;
  $("main").innerHTML = `
    <div class="stephead"><div><h2>Visibility</h2><p>Every comment you leave is recorded here, with how many people saw it. Comment on relevant posts most days and watch these numbers grow.</p></div></div>
    <div class="vk">
      ${k(thisWeek.n, "comments this week", null, "Comments you posted since Monday")}
      ${k(totalImp, "people saw your comments", null, "Impressions on all your recorded comments, from your Comments activity page")}
      ${k(avg, "seen per comment, on average", null, "Impressions ÷ comments that have numbers")}
      ${k(last?.profileViewers90d, "profile viewers, 90 days", "profileViewers90d", "From your LinkedIn dashboard")}
      ${k(last?.searchAppearances, "search appearances, last week", "searchAppearances", "From your LinkedIn dashboard")}
      ${k(last?.followers, "followers", "followers", "From your LinkedIn dashboard")}
    </div>
    <p class="note">Numbers update when you open <a href="https://www.linkedin.com/in/me/recent-activity/comments/" target="_blank" rel="noopener">your Comments page ↗</a> (comment reactions and impressions) and <a href="https://www.linkedin.com/dashboard/" target="_blank" rel="noopener">your LinkedIn dashboard ↗</a> (profile numbers)${days.length ? `. Last dashboard read: ${new Date(days.at(-1)).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ". Not read yet"}.</p>
    <div class="grid" style="margin-top:16px">
      <div class="card"><h2>Comments per week</h2><div class="wk">${per.map((x) => `<div class="c" data-tip="${esc(`Week of ${x.w}: ${x.n} comments, ${x.imp.toLocaleString()} impressions`)}"><b>${x.n || ""}</b><i style="height:${(80 * x.n) / maxN}%;min-height:${x.n ? 4 : 0}px"></i>${new Date(x.w).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>`).join("")}</div></div>
      <div class="card"><h2>Profile viewers over time</h2>${days.length > 1 ? `<div class="wk">${days.slice(-12).map((d) => { const v = snapshots[d].profileViewers90d || 0; const mx = Math.max(...days.slice(-12).map((x) => snapshots[x].profileViewers90d || 0), 1); return `<div class="c"><b>${v}</b><i style="height:${(80 * v) / mx}%;background:#30b0c7"></i>${new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>`; }).join("")}</div>` : `<div class="muted" style="padding:20px 0">Open your LinkedIn dashboard on different days to see this grow.</div>`}</div>
      <div class="card full"><h2>Your comments · ${comments.length}</h2>
        ${comments.length ? comments.slice(0, 100).map((c) => `<div class="cm"><div class="d">${new Date(c.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}${c.source === "imported" ? `<br><span data-tip="Found on your Comments page; the date is approximate">≈</span>` : ""}</div>
          <div><a class="a" href="${esc(c.author?.url || c.pageUrl || "#")}" target="_blank" rel="noopener">${esc(c.author?.name || "A post")}</a><div class="pt">${esc(c.postText)}</div><div class="me" dir="auto">${esc(c.comment)}</div></div>
          <div class="n">${c.checkedAt ? `<b>${(c.impressions || 0).toLocaleString()}</b><span>seen</span>` : `<span data-tip="Open your Comments page to fetch the numbers">not read yet</span>`}</div>
          <div class="n">${c.checkedAt ? `<b>${c.reactions || 0}</b><span>reactions</span>` : ""}</div></div>`).join("")
          : `<div class="muted" style="padding:10px 0">No comments recorded yet. Comment on a post in your feed (the extension records it when you press Comment), or open <a href="https://www.linkedin.com/in/me/recent-activity/comments/" target="_blank" rel="noopener">your Comments page</a> to bring in the ones you already left.</div>`}
      </div>
    </div>`;
}
chrome.storage?.onChanged?.addListener((ch) => { if ((ch.comments || ch.visibility) && vis) { vis = null; if (page === "visibility") renderVisibility(); } });

// ── Offers: what you sell. Shared with the panel's Connect form and the CLI ──
let offersData = null, editingOffer = null, addingOffer = false;
const icpSelect = (v) => `<select data-f="icp"><option value="">Any kind of person</option>${ICPS.map((i) => `<option value="${i.id}" ${v === i.id ? "selected" : ""}>${esc(i.short)}</option>`).join("")}</select>`;
async function renderOffers() {
  if (!offersData) { $("main").innerHTML = `<div class="card empty">Loading…</div>`; const r = await send("offers"); offersData = r?.ok ? r.data : []; if (!r?.ok) { $("main").innerHTML = `<div class="card empty err">${esc(r?.error || "Could not load offers")}</div>`; return; } if (page !== "offers") return; }
  const pitched = (id) => data.people.filter((p) => (p.offers || []).includes(id)).length;
  const when = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "never";
  $("main").innerHTML = `
    <div class="stephead"><div><h2>Offers</h2><p>What you sell, one line each. When you press Connect on LinkedIn, the panel shows these, most recently used first. Picking who someone is selects the offer made for them.</p></div></div>
    ${addingOffer ? `<div class="newoffer" id="newOffer"><b>New offer</b>
        <input data-f="name" placeholder="Name, e.g. Cerver for agencies"><textarea data-f="pitch" placeholder="One line: what they get"></textarea>${icpSelect("")}
        <div class="row-actions"><button class="btn primary" id="addSave">Add offer</button><button class="btn" id="addCancel">Cancel</button><span class="err" id="addErr"></span></div></div>`
      : `<div class="row-actions" style="margin:0 0 16px"><button class="btn primary" id="addOffer">+ New offer</button></div>`}
    <div class="offers">${offersData.length ? offersData.map((o) => editingOffer === o.id ? `<div class="offer" data-id="${esc(o.id)}">
        <input data-f="name" value="${esc(o.name)}"><textarea data-f="pitch">${esc(o.pitch)}</textarea>${icpSelect(o.icp || "")}
        <div class="row-actions"><button class="btn primary" data-save>Save</button><button class="btn" data-cancel>Cancel</button><button class="btn danger" data-del style="margin-left:auto">Delete</button><span class="err"></span></div></div>`
      : `<div class="offer" data-id="${esc(o.id)}">
        <div class="oh"><div class="on2">${esc(o.name)}</div>${o.icp && icpOf(o.icp) ? `<span class="icp-badge" style="margin:0">${esc(icpOf(o.icp).short)}</span>` : ""}<button class="btn" data-edit>Edit</button></div>
        ${o.pitch ? `<div class="op">${esc(o.pitch)}</div>` : ""}
        <div class="meta" style="margin-top:8px">Used ${o.uses}× · last ${when(o.lastUsedAt)} · ${pitched(o.id)} ${pitched(o.id) === 1 ? "person" : "people"} pitched</div>
        <div class="oid" data-tip="Its id, for the CLI">${esc(o.id)}</div></div>`).join("")
      : `<div class="card empty">No offers yet. Add one above.</div>`}</div>
    <div class="cli">From the terminal (in ~/Code/p_98_agentic_contacts):
npm run cli -- offers
npm run cli -- offer-add -n "Name" -p "what they get" -i agency-builder
npm run cli -- offer-edit &lt;id&gt; -p "new pitch"
npm run cli -- offer-rm &lt;id&gt;</div>`;
  const vals = (el) => Object.fromEntries([...el.querySelectorAll("[data-f]")].map((f) => [f.dataset.f, f.value.trim()]));
  $("addOffer")?.addEventListener("click", () => { addingOffer = true; renderOffers(); setTimeout(() => document.querySelector('#newOffer [data-f="name"]')?.focus()); });
  $("addCancel")?.addEventListener("click", () => { addingOffer = false; renderOffers(); });
  $("addSave")?.addEventListener("click", async () => {
    const v = vals($("newOffer"));
    if (!v.name) return ($("addErr").textContent = "Give it a name.");
    const r = await send("saveOffer", v);
    if (!r?.ok) return ($("addErr").textContent = r?.error || "Could not save");
    addingOffer = false; offersData = null; renderOffers();
  });
  document.querySelectorAll(".offer").forEach((el) => {
    const id = el.dataset.id;
    el.querySelector("[data-edit]")?.addEventListener("click", () => { editingOffer = id; renderOffers(); });
    el.querySelector("[data-cancel]")?.addEventListener("click", () => { editingOffer = null; renderOffers(); });
    el.querySelector("[data-save]")?.addEventListener("click", async () => {
      const v = vals(el);
      if (!v.name) return (el.querySelector(".err").textContent = "Give it a name.");
      const r = await send("updateOffer", { id, ...v });
      if (!r?.ok) return (el.querySelector(".err").textContent = r?.error || "Could not save");
      editingOffer = null; offersData = null; renderOffers();
    });
    el.querySelector("[data-del]")?.addEventListener("click", async (e) => {
      if (e.target.dataset.sure !== "1") { e.target.dataset.sure = "1"; e.target.textContent = "Click again to delete"; return; }
      await send("deleteOffer", { id });
      editingOffer = null; offersData = null; renderOffers();
    });
  });
}

// ── Start ──
document.querySelectorAll("[data-page]").forEach((b) => b.onclick = () => go(b.dataset.page));
renderPage();
loadPosts();
send("rhythm").then((r) => { if (r?.ok) rhythm = r.data; else rhythm = null; counts(); if (page === "today" || page === "follow") r?.ok ? renderPage() : ($("main").innerHTML = `<div class="card empty err">${esc(r?.error || "Could not load")}</div>`); });
load();
