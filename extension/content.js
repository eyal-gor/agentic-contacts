// LinkedIn side of Agentic Contacts.
//
// - On a profile: a side panel shows what you know about the person (why you
//   wanted them, notes, follow-up, history) with one-tap logging and
//   reminders; or adds them in one click.
// - Pressing LinkedIn's "Connect" anywhere opens the panel on that person and
//   asks why, so the reason is saved with the request.
// - When someone you asked accepts (their profile now says "1st"), it is
//   recorded the next time you open their profile.
// - On Sent invitations, every pending request is listed with its reason,
//   and the ones with no reason get a box to write it.
// - Anywhere: people already in your contacts get a dot by their name.
//
// All API calls go through background.js; this file only reads the page.

(() => {
  if (window.__agenticContacts) return;
  window.__agenticContacts = true;

  const send = (type, payload = {}) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...payload }, (r) => resolve(r || { ok: false, error: chrome.runtime.lastError?.message || "No answer" }));
      } catch {
        resolve({ ok: false, error: "The extension was reloaded. Refresh this page." });
      }
    });

  const slugOf = (url) => {
    const v = String(url || "").toLowerCase();
    const m = v.match(/linkedin\.com\/(in|pub)\/([^/?#]+)/) || v.match(/^\/(in|pub)\/([^/?#]+)/);
    if (!m) return null;
    let s = m[2];
    try { s = decodeURIComponent(s); } catch {}
    return `${m[1]}/${s}`;
  };
  const profileUrl = (slug) => `https://www.linkedin.com/${slug}/`;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();
  const onThread = () => /^\/messaging\/thread\//.test(location.pathname);
  const norm = (n) => clean(n).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\u0590-\u05ff ]/g, "").trim();
  const sameName = (a, b) => {
    const x = norm(a), y = norm(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [xf, ...xr] = x.split(" "), [yf, ...yr] = y.split(" ");
    return xf === yf && (xr.at(-1) || "") === (yr.at(-1) || "");
  };

  // ── Suggestions under an input ─────────────────────────────────────
  // Opens on click/focus with everything in use (most-used first), filters
  // as you type, ↑/↓ + Enter to pick, Esc to close. multi: comma-separated
  // values (tags); the last one is completed and used ones are left out.
  let openBox = null;
  function attachSuggest(input, source, { multi = false } = {}) {
    if (!input || input.dataset.acSuggest) return;
    input.dataset.acSuggest = "1";
    input.setAttribute("autocomplete", "off");
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;z-index:2147483647;display:none;background:#fff;border:1px solid #d1d5db;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.16);max-height:230px;overflow:auto;padding:3px 0;font:12.5px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;text-align:left;";
    input.after(box);
    let typed = false, items = [], sel = -1;
    const parts = () => input.value.split(",");
    const token = () => (multi ? parts().at(-1) : input.value).trim();
    const hide = () => { box.style.display = "none"; if (openBox === hide) openBox = null; };
    function paint() {
      box.innerHTML = items.map((x, i) => `<div data-i="${i}" style="display:flex;justify-content:space-between;gap:12px;padding:5px 10px;cursor:pointer;${i === sel ? "background:#eef2ff;" : ""}"><span>${esc(x.name)}</span><span style="color:#9ca3af">${x.count}</span></div>`).join("");
      box.querySelectorAll("[data-i]").forEach((el) => {
        el.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); pick(Number(el.dataset.i)); });
        el.addEventListener("mouseenter", () => { sel = Number(el.dataset.i); paint(); });
      });
    }
    function show() {
      const q = typed ? token().toLowerCase() : "";
      const used = new Set(multi ? parts().slice(0, -1).map((t) => t.trim().toLowerCase()) : []);
      const all = source().filter((x) => !used.has(x.name.toLowerCase()));
      items = (q
        ? [...all.filter((x) => x.name.toLowerCase().startsWith(q)), ...all.filter((x) => !x.name.toLowerCase().startsWith(q) && x.name.toLowerCase().includes(q))]
        : all).slice(0, 12);
      if (!items.length) return hide();
      sel = typed ? -1 : items.findIndex((x) => x.name.toLowerCase() === token().toLowerCase());
      paint();
      openBox?.(); openBox = hide;
      box.style.display = "block";
      const r = input.getBoundingClientRect();
      box.style.left = r.left + "px";
      box.style.minWidth = Math.max(r.width, 180) + "px";
      const h = box.offsetHeight;
      box.style.top = (innerHeight - r.bottom < h + 8 && r.top > h + 8 ? r.top - h - 2 : r.bottom + 2) + "px";
    }
    function pick(i) {
      const name = items[i]?.name;
      if (!name) return;
      if (multi) {
        const p = parts().slice(0, -1).map((t) => t.trim()).filter(Boolean);
        input.value = [...p, name].join(", ") + ", ";
        typed = false;
        show();
      } else {
        input.value = name;
        hide();
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }
    input.addEventListener("focus", () => { typed = false; show(); });
    input.addEventListener("click", () => { if (box.style.display === "none") { typed = false; show(); } });
    input.addEventListener("input", (e) => { if (e.isTrusted) { typed = true; show(); } });
    input.addEventListener("blur", () => setTimeout(hide, 120));
    input.addEventListener("keydown", (e) => {
      if (box.style.display === "none") { if (e.key === "ArrowDown") { typed = false; show(); e.preventDefault(); } return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        paint();
        box.children[sel]?.scrollIntoView({ block: "nearest" });
      } else if ((e.key === "Enter" || e.key === "Tab") && sel >= 0) {
        e.preventDefault(); e.stopPropagation();
        pick(sel);
      } else if (e.key === "Escape") {
        e.stopPropagation();
        hide();
      }
    });
  }
  addEventListener("scroll", () => openBox?.(), true);
  // (the panel's own scroll doesn't reach the window: hooked after the panel exists)

  const onProfile = () => /^\/(in|pub)\/[^/]+\/?$/.test(location.pathname);
  const onSentPage = () => location.pathname.startsWith("/mynetwork/invitation-manager/sent");

  // ── Panel shell ─────────────────────────────────────────────────────
  const host = document.createElement("div");
  host.id = "agentic-contacts-host";
  host.style.cssText = "position:fixed;top:72px;right:12px;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      .wrap { display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
      .tab { display:flex; align-items:center; gap:6px; max-width:320px; padding:6px 11px; background:#111827; color:#fff; border:none; border-radius:999px; font-size:12px; font-weight:600; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.2); }
      #tabText { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .due { flex:none; min-width:18px; padding:0 5px; border-radius:999px; background:#ef4444; color:#fff; font-size:11px; line-height:18px; text-align:center; }
      .due[hidden] { display:none; }
      .duerow { display:flex; justify-content:space-between; gap:6px; padding:7px 0; border-bottom:1px solid #f3f4f6; }
      .duerow .n { font-weight:600; } .duerow .t { color:#6b7280; font-size:12px; }
      .duerow .acts { display:flex; flex-direction:column; gap:3px; flex:none; }
      .mini { padding:2px 8px; border:1px solid #d1d5db; background:#fff; border-radius:999px; font-size:11px; cursor:pointer; color:#374151; }
      .mini.ok { border-color:#86efac; background:#f0fdf4; color:#166534; }
      .late { color:#b91c1c; }
      .dr { display:grid; grid-template-columns:1fr auto; column-gap:8px; padding:7px 0; border-bottom:.5px solid #e5e5ea; }
      .dr:last-child { border-bottom:none; }
      .dr .l1 { display:flex; align-items:center; gap:6px; min-width:0; }
      .dr .nm { font-size:13px; font-weight:600; color:#1d1d1f; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .dr .nm:hover { color:#4f46e5; }
      .dr .l2 { grid-column:1; display:flex; align-items:baseline; gap:5px; min-width:0; margin-top:1px; font-size:11.5px; color:#6e6e73; }
      .dr .rs { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .dr .rs.dim { color:#a1a1a6; }
      .dr .when { flex:none; font-size:10.5px; color:#a1a1a6; font-variant-numeric:tabular-nums; }
      .dr .when.late { color:#d70015; }
      .dr .tag { flex:none; padding:0 5px; border-radius:4px; background:#eef0ff; color:#4f46e5; font-size:10.5px; line-height:15px; }
      .dr .ac { grid-column:2; grid-row:1 / span 2; display:flex; align-items:center; gap:4px; }
      .ib { width:26px; height:22px; padding:0; border:none; border-radius:6px; background:#f2f2f7; color:#3a3a3c; font-size:11px; font-weight:600; cursor:pointer; }
      .ib:hover { background:#e5e5ea; } .ib.ok:hover { background:#d1fadf; color:#067d34; }
      .ib:disabled { opacity:.4; }
      .mt { flex:none; display:inline-flex; align-items:center; gap:2px; font-size:10.5px; color:#8e8e93; font-variant-numeric:tabular-nums; }
      .mt i { width:6px; height:6px; border-radius:1.5px; background:#5e5ce6; display:inline-block; }
      .mt i.e { background:none; box-shadow:inset 0 0 0 1px #c7c7cc; }
      .mt span { margin-left:3px; }
      .mt.rep i { background:#34c759; } .mt.rep span { color:#248a3d; }
      .dot { flex:none; width:8px; height:8px; border-radius:50%; background:#9ca3af; }
      .dot.known { background:#22c55e; } .dot.req { background:#f59e0b; }
      .panel { width:360px; max-height:calc(100vh - 110px); overflow:auto; background:#fff; color:#111827; border:1px solid #e5e7eb; border-radius:14px; box-shadow:0 10px 30px rgba(0,0,0,.18); padding:0 14px 14px; font-size:13px; line-height:1.45; }
      .vt { position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:2px; margin:0 -14px 10px; padding:8px 8px 8px 10px; background:rgba(255,255,255,.94); backdrop-filter:blur(8px); border-bottom:.5px solid #e5e5ea; }
      .vt .seg2 { flex:1; display:flex; gap:2px; padding:2px; border-radius:9px; background:#f2f2f7; min-width:0; }
      .vt .seg2 button { flex:1 1 auto; min-width:0; display:flex; align-items:center; justify-content:center; gap:4px; padding:5px 4px; border:none; border-radius:7px; background:none; color:#3a3a3c; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap; }
      .vt .seg2 button.on { background:#fff; color:#1d1d1f; box-shadow:0 1px 3px rgba(0,0,0,.12), 0 0 0 .5px rgba(0,0,0,.04); }
      .vt .seg2 button .lb { overflow:hidden; text-overflow:ellipsis; }
      .vt .n { flex:none; min-width:15px; padding:0 4px; border-radius:999px; background:#d1d1d6; color:#fff; font-size:10px; line-height:15px; }
      .vt .n.hot { background:#ff3b30; }
      .vt .x { margin-left:4px; }
      .pc { padding:9px 0; border-bottom:.5px solid #e5e5ea; }
      .pc:last-child { border-bottom:none; }
      .pc .l1 { display:flex; align-items:center; gap:6px; }
      .pc .au { flex:1; min-width:0; font-size:13px; font-weight:600; color:#1d1d1f; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .pc .tx { margin-top:2px; font-size:12px; color:#6e6e73; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .pc .rv { margin-top:6px; padding:7px 9px; border-radius:8px; background:#f5f5f7; font-size:12px; }
      .pc .rv b { color:#1d1d1f; }
      .pc .acts2 { display:flex; gap:5px; flex-wrap:wrap; margin-top:6px; }
      .fit { flex:none; padding:0 6px; border-radius:5px; font-size:10.5px; font-weight:700; line-height:16px; background:#eef0ff; color:#4f46e5; }
      .fit.lo { background:#f2f2f7; color:#8e8e93; } .fit.hi { background:#e3f9e9; color:#1f7a3a; }
      .goal { margin:8px 0; }
      .goal .gl { display:flex; justify-content:space-between; font-size:12.5px; font-weight:600; color:#1d1d1f; }
      .goal .gl span { color:#8e8e93; font-weight:500; font-variant-numeric:tabular-nums; }
      .bar { height:6px; margin-top:4px; border-radius:3px; background:#f2f2f7; overflow:hidden; }
      .bar i { display:block; height:100%; border-radius:3px; background:#5e5ce6; }
      .bar i.done { background:#34c759; }
      .streak { display:flex; align-items:baseline; gap:6px; font-size:12px; color:#6e6e73; }
      .streak b { font-size:22px; color:#1d1d1f; }
      .panel[hidden] { display:none; }
      .top { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
      h3 { margin:0; font-size:15px; }
      .x { background:none; border:none; font-size:18px; line-height:1; color:#9ca3af; cursor:pointer; padding:0 2px; }
      .sub { color:#6b7280; font-size:12px; margin:2px 0 8px; }
      .chips { margin-bottom:6px; }
      .chip { display:inline-block; padding:1px 8px; border-radius:999px; background:#f3f4f6; color:#374151; font-size:11px; margin:0 4px 4px 0; }
      .chip.ok { background:#dcfce7; color:#166534; } .chip.req { background:#fef3c7; color:#92400e; } .chip.stage { background:#e0e7ff; color:#3730a3; }
      .sec { margin-top:12px; }
      .h { font-size:11px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; }
      .why { background:#eef2ff; border-left:3px solid #6366f1; padding:6px 8px; margin:4px 0; border-radius:4px; }
      .why .d, .muted { color:#9ca3af; font-size:11px; }
      .notes { white-space:pre-wrap; font-size:12.5px; color:#374151; max-height:7.5em; overflow:hidden; }
      .notes.open { max-height:none; }
      .fu { background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:6px 8px; font-size:12px; }
      input[type=text], textarea { width:100%; padding:7px 8px; border:1px solid #d1d5db; border-radius:6px; font-size:13px; color:#111827; background:#fff; }
      textarea { min-height:52px; resize:vertical; }
      .lbl { display:block; font-size:11px; font-weight:600; color:#6b7280; margin:8px 0 3px; }
      .row { display:flex; align-items:center; gap:6px; margin-top:6px; font-size:12px; color:#374151; flex-wrap:wrap; }
      .seg { display:flex; gap:4px; flex-wrap:wrap; margin:6px 0; }
      .seg button, .pill { padding:4px 9px; border:1px solid #d1d5db; background:#fff; border-radius:999px; font-size:12px; color:#374151; cursor:pointer; }
      .seg button.on { background:#111827; color:#fff; border-color:#111827; }
      .go { margin-top:8px; width:100%; padding:8px; border:none; border-radius:6px; background:#4f46e5; color:#fff; font-weight:600; font-size:13px; cursor:pointer; }
      .go:disabled { opacity:.6; cursor:default; }
      .link { background:none; border:none; color:#4f46e5; cursor:pointer; padding:0; font-size:12px; }
      a { color:#4f46e5; text-decoration:none; font-size:12px; }
      .hist div { margin-bottom:6px; font-size:12px; }
      .err { color:#b91c1c; font-size:12px; margin-top:6px; }
      .ok-msg { color:#166534; font-size:12px; margin-top:6px; }
      .person { padding:8px 0; border-bottom:1px solid #f3f4f6; }
      .person .n { font-weight:600; } .person .t { color:#6b7280; font-size:12px; }
      .person form { display:flex; gap:4px; margin-top:4px; }
      .person form input { flex:1; padding:5px 7px; font-size:12px; }
      .stats { width:100%; border-collapse:collapse; font-size:12px; }
      .stats th { color:#9ca3af; font-weight:600; font-size:10.5px; text-align:right; padding:2px 3px; }
      .stats td { text-align:right; padding:4px 3px; border-top:1px solid #f3f4f6; }
      .stats td.cn { text-align:left; color:#3730a3; font-weight:600; max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .stats tr[data-camp] { cursor:pointer; } .stats tr[data-camp]:hover td { background:#f9fafb; }
      .seg.small button { padding:2px 7px; font-size:11px; }
      .draft { margin-top:6px; }
      .count { font-size:11px; color:#9ca3af; } .count.over { color:#b91c1c; }
      .msgprev { background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:6px 8px; font-size:12px; margin:4px 0; max-height:6em; overflow:hidden; }
      .person form button { padding:5px 9px; border:none; border-radius:6px; background:#4f46e5; color:#fff; font-size:12px; cursor:pointer; }
    </style>
    <div class="wrap">
      <button class="tab" id="tab"><img src="${chrome.runtime.getURL("icon-32.png")}" alt="" style="width:14px;height:14px;flex:none;"><span class="dot" id="dot"></span><span id="tabText">Contacts</span><span class="due" id="due" hidden></span></button>
      <div class="panel" id="box" hidden><nav class="vt" id="vt"></nav><div id="panel"></div></div>
    </div>`;
  document.documentElement.appendChild(host);
  const $ = (id) => root.getElementById(id);
  const panel = $("panel");
  const box = $("box");
  box.addEventListener("scroll", () => openBox?.());

  // ── Tooltips: quick, readable, for anything with a title or data-tip ──
  const tip = document.createElement("div");
  tip.style.cssText = "position:fixed;z-index:2147483647;display:none;max-width:240px;padding:6px 9px;border-radius:7px;background:rgba(29,29,31,.94);color:#f5f5f7;font:12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:pre-line;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.18);";
  root.appendChild(tip);
  let tipTimer = null;
  root.addEventListener("mouseover", (e) => {
    const el = e.target.closest?.("[title], [data-tip]");
    if (!el) return;
    if (el.hasAttribute("title")) { el.dataset.tip = el.getAttribute("title"); el.removeAttribute("title"); }
    const text = el.dataset.tip;
    if (!text) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      tip.textContent = text;
      tip.style.display = "block";
      const r = el.getBoundingClientRect();
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.min(Math.max(r.left + r.width / 2 - w / 2, 6), innerWidth - w - 6) + "px";
      tip.style.top = (r.top > h + 10 ? r.top - h - 6 : r.bottom + 6) + "px";
    }, 250);
  });
  root.addEventListener("mouseout", (e) => {
    if (e.target.closest?.("[data-tip]") && !e.relatedTarget?.closest?.("[data-tip]")) { clearTimeout(tipTimer); tip.style.display = "none"; }
  });
  root.addEventListener("mousedown", () => { clearTimeout(tipTimer); tip.style.display = "none"; });

  // ── Moving the pill: drag it anywhere; double-click puts it back ─────
  // The panel opens toward the middle of the screen from wherever it sits.
  let pos = null; // { x, y } of the pill's top-left, or null for the default corner
  function place() {
    const wrap = root.querySelector(".wrap");
    if (!pos) {
      host.style.cssText = "position:fixed;top:72px;right:12px;left:auto;bottom:auto;z-index:2147483646;";
      wrap.style.alignItems = "flex-end";
      wrap.style.flexDirection = "column";
      return;
    }
    const x = Math.min(Math.max(pos.x, 4), innerWidth - 60);
    const y = Math.min(Math.max(pos.y, 4), innerHeight - 40);
    const right = x > innerWidth / 2;
    const low = y > innerHeight / 2;
    host.style.cssText = `position:fixed;z-index:2147483646;${right ? `right:${Math.max(innerWidth - x - $("tab").offsetWidth, 4)}px;left:auto;` : `left:${x}px;right:auto;`}${low ? `bottom:${Math.max(innerHeight - y - $("tab").offsetHeight, 4)}px;top:auto;` : `top:${y}px;bottom:auto;`}`;
    wrap.style.alignItems = right ? "flex-end" : "flex-start";
    wrap.style.flexDirection = low ? "column-reverse" : "column";
  }
  chrome.storage.local.get("pillPos").then(({ pillPos }) => { pos = pillPos || null; place(); });
  addEventListener("resize", place);

  let drag = null;
  let dragged = false;
  $("tab").addEventListener("mousedown", (e) => {
    const r = $("tab").getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY };
    dragged = false;
    e.preventDefault();
  });
  addEventListener("mousemove", (e) => {
    if (!drag) return;
    if (!dragged && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
    dragged = true;
    pos = { x: e.clientX - drag.dx, y: e.clientY - drag.dy };
    place();
  });
  addEventListener("mouseup", () => {
    if (drag && dragged) chrome.storage.local.set({ pillPos: pos });
    drag = null;
  });
  $("tab").addEventListener("dblclick", () => { pos = null; chrome.storage.local.remove("pillPos"); place(); });

  let index = {};        // slug → { id, name, why, reasonSaved, requested, tags }
  let campaigns = [];    // [{ name, count }]
  let tagList = [];      // [{ name, count }] tags in use, for suggestions
  let dueList = [];      // follow-ups due today or earlier
  let connectPerson = null; // who the last LinkedIn "Connect" click was for
  let lastCampaign = ""; // remembered between saves
  let offersList = [];   // [{ id, name, pitch, lastUsed }], most recent first
  chrome.storage.local.get("lastCampaign").then((v) => { lastCampaign = v.lastCampaign || ""; });
  let target = null;     // the person the panel is about
  let mode = "auto";     // "auto" | "connect" (opened by a Connect click)
  let open = false;
  let flash = "";        // one-line confirmation after a save
  const repliedSeen = new Set();  // contact ids marked replied this page load
  const acceptedSeen = new Set(); // contact ids marked accepted this page load

  // Open or folded is remembered across pages and tabs.
  const setOpen = (v) => { open = v; box.hidden = !v; chrome.storage.local.set({ panelOpen: v }).catch(() => {}); render(); };
  chrome.storage.local.get("panelOpen").then(({ panelOpen }) => { if (panelOpen && !open) { open = true; box.hidden = false; render(); } }).catch(() => {});
  $("tab").onclick = () => { if (dragged) { dragged = false; return; } setOpen(!open); };
  const closeBtn = () => "";
  const wireClose = () => {};

  // ── Tabs inside the panel: Here (this page or person) · Due · Posts · Today · Campaigns ──
  let view = "here";
  chrome.storage.local.get("panelView").then(({ panelView }) => { if (panelView === "due" || panelView === "camps") panelView = "today"; if (panelView && panelView !== view) { view = panelView; if (open) render(); } }).catch(() => {});
  const setView = (v) => { view = v; chrome.storage.local.set({ panelView: v }).catch(() => {}); render(); };
  function paintViews() {
    const k = target && index[target.slug];
    const here = onSentPage() ? "Invites" : target ? (target.name || "Person").split(" ")[0] : "Page";
    const unreviewed = postsCache.filter((p) => !p.review).length;
    const tabs = [
      ["here", here, k ? "" : "", target ? `${target.name || "This person"}: what you know, why, stage, notes` : "This page: who here is in your contacts"],
      ["today", "Today", dueList.length ? `<span class="n hot">${dueList.length}</span>` : "", "Your 3 steps for today: pick, reach out, follow up" + (dueList.length ? `\n${dueList.length} follow-ups due` : "")],
      ["posts", "__icon", postsCache.length ? `<span class="n ${unreviewed ? "hot" : ""}">${postsCache.length}</span>` : "", "Posts you bookmarked on Agentic Contacts. Claude reviews them" + (unreviewed ? `\n${unreviewed} not reviewed yet` : "")],
    ];
    $("vt").innerHTML = `<div class="seg2">${tabs.map(([id, label, badge, tipText]) => `<button data-view="${id}" class="${view === id ? "on" : ""}" data-tip="${esc(tipText)}">${label === "__icon" ? `<span class="lb" style="display:flex">${BOOKMARK(true, 15)}</span>` : `<span class="lb">${esc(label)}</span>`}${badge}</button>`).join("")}</div><button class="x" id="close" data-tip="Fold the panel">×</button>`;
    $("vt").querySelectorAll("[data-view]").forEach((b) => b.onclick = () => setView(b.dataset.view));
    $("close").onclick = () => setOpen(false);
  }

  // ── Reading the page ────────────────────────────────────────────────
  // LinkedIn's class names are generated, so read by structure: the name is
  // in the tab title and in a heading; the texts that follow it are the
  // degree ("· 1st"), the headline, the current company and the location.
  const pendingOnPage = () => [...document.querySelectorAll("main button, main a")].some((b) => b.offsetParent && (/^Pending/i.test(clean(b.innerText)) || /^Pending, click to withdraw/i.test(b.getAttribute("aria-label") || "")));
  // However the request went out (a menu, a one-click send), when this
  // profile's button turns to Pending, ask why and what to say.
  function watchPending() {
    if (!onProfile() || !target || target.pending || mode === "connect" || mode === "preconnect" || !pendingOnPage()) return;
    target.pending = true;
    connectPerson = target;
    mode = "connect";
    view = "here";
    setOpen(true);
  }
  function readProfile() {
    const slug = slugOf(location.pathname);
    if (!slug) return null;
    const name = clean(document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*\|\s*LinkedIn\s*$/i, ""));
    const heading = [...document.querySelectorAll("main h1, main h2, h1, h2")].find((h) => clean(h.innerText) === name);
    const texts = [];
    if (heading) {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      w.currentNode = heading;
      let n;
      while ((n = w.nextNode()) && texts.length < 14) {
        const t = clean(n.textContent);
        // LinkedIn keeps hidden copies (e.g. a "· 1st" for after you connect): read only what's shown.
        const el = n.parentElement;
        const shown = el && (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.offsetParent !== null);
        if (t && shown && !host.contains(el)) texts.push(t);
      }
    }
    const degree = (texts.find((t) => /^·\s*(1st|2nd|3rd\+?)$/.test(t)) || "").replace(/^·\s*/, "");
    const rest = texts.filter((t) => t !== name && t !== "●" && t !== "·" && !/^·\s*(1st|2nd|3rd\+?)$/.test(t) && !/^(he|she|they)\/\w+$/i.test(t));
    const title = rest[0] || "";
    const contactIdx = rest.indexOf("Contact info");
    const location_ = contactIdx > 0 ? rest[contactIdx - 1] : "";
    let company = (title.match(/\b(?:at|@)\s+(.+)$/i) || [])[1] || "";
    if (!company && rest[1] && rest[1] !== location_ && rest[1] !== "Contact info") company = rest[1];
    company = clean(company).replace(/\s*[|·•].*$/, "").replace(/\s+[-–—]\s.*$/, "");
    const pending = pendingOnPage();
    return { slug, url: profileUrl(slug), name, title, company, location: location_, degree, pending };
  }

  // Rows on the Sent invitations page: name, headline, "Sent 6 days ago".
  function readSentInvites() {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll('main a[href*="/in/"]')) {
      const s = slugOf(a.href);
      if (!s || seen.has(s)) continue;
      let row = a;
      for (let i = 0; i < 8 && row && !/Withdraw/.test(row.innerText || ""); i++) row = row.parentElement;
      if (!row) continue;
      seen.add(s);
      const lines = (row.innerText || "").split("\n").map(clean).filter(Boolean).filter((l) => l !== "Withdraw");
      out.push({ slug: s, url: profileUrl(s), name: lines[0] || s, title: lines[1] || "", sent: lines.find((l) => /^Sent /.test(l)) || "" });
    }
    return out;
  }

  function knownOnPage() {
    const seen = new Map();
    const here = slugOf(location.pathname);
    document.querySelectorAll('a[href*="/in/"]').forEach((a) => {
      const s = slugOf(a.href);
      if (s && s !== here && index[s] && !seen.has(s)) seen.set(s, index[s]);
    });
    return [...seen.entries()];
  }

  // ── Tab label ───────────────────────────────────────────────────────
  function paintTab() {
    const k = target && index[target.slug];
    $("dot").className = "dot" + (k ? (k.requested ? " req" : " known") : "");
    let text;
    if (onSentPage()) text = "Sent invitations";
    else if (target) text = k ? (k.why ? k.why : "In contacts") : "Not in contacts";
    else {
      const n = knownOnPage().length;
      text = n ? `${n} contact${n === 1 ? "" : "s"} on this page` : "Contacts";
    }
    $("tabText").textContent = text;
    $("tab").dataset.tip = (k?.why ? "Why: " + k.why + "\n" : "") + (dueList.length ? `Red number: ${dueList.length} follow-up${dueList.length === 1 ? "" : "s"} due\n` : "") + "Click to open · drag to move · double-click to reset";
    $("due").hidden = !dueList.length;
    $("due").textContent = `${dueList.length} due`;
  }

  // ── Rendering ───────────────────────────────────────────────────────
  async function render() {
    paintTab();
    if (!open) return;
    paintViews();
    if (acceptedQueue.length) return renderAccepted();
    if (view === "due") return renderDueView();
    if (view === "posts") return renderPostsView();
    if (view === "today") return renderTodayView();
    if (view === "camps") return renderCampsView();
    if (onSentPage()) return renderSent();
    if (!target) return renderPage();
    panel.innerHTML = `<div class="top"><h3>${esc(target.name || target.slug)}</h3>${closeBtn()}</div><div class="muted">Loading…</div>`;
    wireClose();
    const r = await send("lookup", { url: target.url, name: target.name });
    if (!r.ok) return showError(r.error);
    if (r.data.found) {
      const c = r.data.contact;
      // They accepted since you asked: record it once.
      if (c.requested && target.degree === "1st") {
        const a = await send("accepted", { id: c.id, url: target.url });
        if (a.ok) { flash = "They accepted your request. Saved."; await loadIndex(); return renderKnown(a.data); }
      }
      renderKnown(r.data);
    } else if (r.data.candidate) renderCandidate(r.data.candidate);
    else renderNew();
  }

  const todayStr = () => new Date().toISOString().slice(0, 10);
  // Compact two-line rows:  Name ··········· ■■ 2 · 3w   ✓  ↻
  //                          campaign · reason (one line)          overdue
  const age = (iso) => {
    const d = Math.round((Date.now() - Date.parse(iso)) / 86400000);
    return d <= 0 ? "today" : d < 14 ? d + "d" : d < 60 ? Math.round(d / 7) + "w" : Math.round(d / 30) + "mo";
  };
  // Drop boilerplate like "LinkedIn 1st-degree." at the start of old notes.
  const tidy = (t) => String(t || "").replace(/^(LinkedIn(\s+\d(st|nd|rd)-degree)?|1st-degree)[.,:;\s-]*/i, "").replace(/^Reached out\s+/i, "");
  function dueBlock(limit = Infinity) {
    if (!dueList.length) return `<div class="sec"><div class="h">Follow-ups</div><div class="muted">Nothing due.</div></div>`;
    return `<div class="sec"><div class="h">Due · ${dueList.length}</div>
      ${dueList.slice(0, limit).map((d) => {
        const why = tidy(d.why);
        const late = d.at < todayStr();
        const nice = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
        return `<div class="dr">
        <div class="l1"><a class="nm" href="${esc(d.linkedin || d.appUrl)}" ${d.linkedin ? "" : 'target="_blank"'} data-tip="${d.linkedin ? "Open their LinkedIn profile" : "No LinkedIn saved: opens them in Contacts"}">${esc(d.name)}</a>${nudgeMeter(d)}</div>
        <div class="l2">${d.campaigns.map((c) => `<span class="tag" data-tip="Campaign: the outreach batch you added them under">${esc(c)}</span>`).join("")}<span class="rs ${d.whySaved ? "" : "dim"}" data-tip="${esc((d.whySaved ? "Why you wanted to connect:\n" : why ? "From your notes (no reason saved yet):\n" : "") + (d.why || "") + (d.note ? "\n\nReminder: " + d.note : ""))}">${esc(why || d.note || "No reason saved")}</span><span class="when ${late ? "late" : ""}" data-tip="${late ? `Follow-up was due ${nice(d.at)}, ${age(d.at)} ago` : "Follow-up is due today"}">${late ? age(d.at) + " late" : "today"}</span></div>
        <div class="ac"><button class="ib ok" data-done="${esc(d.id)}" data-tip="Done: you followed up.\nClears the reminder and logs it.">✓</button><button class="ib" data-snooze="${esc(d.id)}" data-tip="Not now: remind me again in 3 days">3d</button></div>
      </div>`;
      }).join("")}</div>`;
  }
  // ■■■ 3 · 2w — one square per nudge you sent; green once they replied.
  function nudgeMeter(d) {
    const n = d.nudges?.count || 0;
    const sq = Array.from({ length: Math.min(n, 5) }, () => `<i></i>`).join("") + (n > 5 ? "+" : "") || `<i class="e"></i>`;
    const ago = d.nudges?.last ? age(d.nudges.last) : "";
    const tipText = (n
      ? `You've reached out ${n} time${n === 1 ? "" : "s"} (requests, messages, follow-ups).\nLast one ${ago === "today" ? "today" : ago + " ago"}.`
      : "You haven't reached out yet.")
      + (d.replied ? "\nGreen: they wrote back." : d.requested ? "\nYour connection request is still pending." : "");
    return `<span class="mt ${d.replied ? "rep" : ""}" data-tip="${esc(tipText)}">${sq}<span>${n ? n + (d.nudges.last ? " · " + age(d.nudges.last) : "") : "0"}</span></span>`;
  }
  function wireDue(after) {
    root.querySelectorAll("[data-done]").forEach((b) => b.onclick = async () => { b.disabled = true; await send("done", { id: b.dataset.done }); await loadIndex(); after(); });
    root.querySelectorAll("[data-snooze]").forEach((b) => b.onclick = async () => { b.disabled = true; await send("snooze", { id: b.dataset.snooze, days: 3 }); await loadIndex(); after(); });
  }

  const STAGES = ["lead", "contacted", "call", "trial", "proposal", "won", "lost"];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── Campaigns (0.4) ─────────────────────────────────────────────────
  async function campaignsBlock() {
    const r = await send("campaignStats");
    const dash = `<button class="mini" id="openDash" data-tip="Full-page funnel, every campaign side by side, filter by campaign">Dashboard ↗</button>`;
    if (!r.ok || !r.data.length) return `<div class="sec"><div class="h" style="display:flex;justify-content:space-between;align-items:center">Campaigns ${dash}</div><div class="muted">None yet. Add a campaign when you save someone.</div></div>`;
    return `<div class="sec"><div class="h" style="display:flex;justify-content:space-between;align-items:center">Campaigns ${dash}</div>
      <table class="stats"><tr><th></th><th data-tip="People tagged with this campaign">ppl</th><th data-tip="You sent them a connection request">asked</th><th data-tip="They accepted your request">acc.</th><th data-tip="They wrote back on LinkedIn">repl.</th><th data-tip="Reached stage call, trial, proposal or won">call+</th></tr>
      ${r.data.map((c) => `<tr data-camp="${esc(c.name)}" data-tip="Open the ${esc(c.name)} funnel in the dashboard"><td class="cn">${esc(c.name)}</td><td>${c.people}</td><td>${c.asked}</td><td>${c.accepted}</td><td>${c.replied}</td><td>${c.call}</td></tr>`).join("")}
      </table></div>`;
  }

  async function renderPage() {
    const people = knownOnPage();
    panel.innerHTML = `${dueList.length ? `<button class="mini" id="goDue" style="margin-bottom:6px">${dueList.length} follow-up${dueList.length === 1 ? "" : "s"} due · see Today ›</button>` : ""}
      <div class="h">On this page</div>
      ${people.length
        ? `<div class="sub">${people.length} ${people.length === 1 ? "person" : "people"} here ${people.length === 1 ? "is" : "are"} in your contacts</div>
           ${people.map(([s, p]) => `<div class="person"><a class="n" href="${esc(profileUrl(s))}">${esc(p.name)}</a>${p.requested ? ` <span class="chip req">asked</span>` : ""}${p.why ? `<div class="t">${esc(p.why)}</div>` : ""}</div>`).join("")}`
        : `<div class="sub">Open a profile to see or add someone. Pressing Connect on anyone asks why and saves it.</div>`}
      <div class="row"><a href="https://www.linkedin.com/mynetwork/invitation-manager/sent/">Sent invitations: add the reasons ›</a></div>
      <div class="row"><a href="https://www.linkedin.com/mynetwork/invite-connect/connections/">Connections: record who accepted ›</a></div>
      <div class="row"><button class="link" id="refresh">Reload contacts</button></div>`;
    $("goDue")?.addEventListener("click", () => setView("today"));
    $("refresh").onclick = async () => { await send("refresh"); await loadIndex(); render(); };
  }

  // ── They accepted: what you wanted to say ──
  let acceptedQueue = [];
  chrome.storage.local.get("acceptedQueue").then(({ acceptedQueue: q = [] }) => { acceptedQueue = q; if (q.length) { open = true; box.hidden = false; render(); } }).catch(() => {});
  chrome.storage.onChanged.addListener((ch) => {
    if (!ch.acceptedQueue) return;
    const before = acceptedQueue.length;
    acceptedQueue = ch.acceptedQueue.newValue || [];
    if (acceptedQueue.length > before) setOpen(true); else if (open) render();
  });
  function renderAccepted() {
    panel.innerHTML = `<div class="h" style="margin-top:2px">They accepted · ${acceptedQueue.length}</div>` + acceptedQueue.map((a) => `<div class="person" data-acc="${esc(a.id)}">
        <a class="n" href="${esc(a.url)}">${esc(a.name)}</a> <span class="chip ok">accepted</span>${a.icp ? ` <span class="chip stage">${esc(a.icp)}</span>` : ""}
        ${a.why ? `<div class="t" style="margin-top:3px"><b>Why you reached out:</b> ${esc(a.why)}</div>` : ""}
        ${a.say ? `<div class="why" dir="auto" style="background:#e3f9e9;border-left-color:#34c759"><b>You wanted to say:</b><br>${esc(a.say)}</div>` : `<div class="t muted">You didn't write a message for later. Send a first message.</div>`}
        <div class="row" style="margin-top:2px">${a.say ? `<button class="mini ok" data-copy="${esc(a.say)}">Copy</button>` : ""}<a class="mini" href="${esc(a.url)}" style="text-decoration:none">Open profile</a><button class="mini" data-ack="${esc(a.id)}" data-tip="Hide this. It stays on their card in Contacts.">Done</button></div>
      </div>`).join("");
    panel.querySelectorAll("[data-copy]").forEach((b) => b.onclick = async () => { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied ✓"; });
    panel.querySelectorAll("[data-ack]").forEach((b) => b.onclick = () => send("ackAccepted", { id: b.dataset.ack }));
  }

  // ── Due tab ──
  function renderDueView() {
    panel.innerHTML = dueBlock().replace('<div class="sec">', '<div>');
    wireDue(render);
  }

  // ── Campaigns tab ──
  async function renderCampsView() {
    panel.innerHTML = `<div class="muted">Loading…</div>`;
    const html = await campaignsBlock();
    if (view !== "camps") return;
    panel.innerHTML = html.replace('<div class="sec">', '<div>') + `
      <div class="row"><a href="https://www.linkedin.com/mynetwork/invitation-manager/sent/">Sent invitations: add the reasons ›</a></div>
      <div class="row"><a href="https://www.linkedin.com/mynetwork/invite-connect/connections/">Connections: record who accepted ›</a></div>`;
    root.querySelectorAll("[data-camp]").forEach((tr) => tr.onclick = () => send("openDashboard", { campaign: tr.dataset.camp }));
    $("openDash")?.addEventListener("click", () => send("openDashboard"));
  }

  // ── Posts tab: saved from the feed, reviewed by Claude ──
  let postsCache = [];
  const postReviewing = new Set();
  chrome.storage.local.get("posts").then(({ posts = [] }) => { postsCache = posts; if (open) { paintViews(); if (view === "posts") renderPostsView(); } }).catch(() => {});
  chrome.storage.onChanged.addListener((ch) => {
    if (!ch.posts) return;
    postsCache = ch.posts.newValue || [];
    if (open) { paintViews(); if (view === "posts" && !postReviewing.size) renderPostsView(); }
  });
  const postHref = (p) => p.url || (/linkedin\.com\/(in|company)\//.test(p.author?.url || "") ? p.author.url.replace(/\/?$/, "/") + (p.author.url.includes("/company/") ? "posts/" : "recent-activity/all/") : p.pageUrl);
  const icpName = (id) => (self.ICPS || []).find((i) => i.id === id);
  function renderPostsView(errFor, errMsg) {
    const list = [...postsCache].sort((a, b) => (b.review?.fit ?? -1) - (a.review?.fit ?? -1) || b.savedAt.localeCompare(a.savedAt));
    const todo = list.filter((p) => !p.review).length;
    if (!list.length) {
      panel.innerHTML = `<div class="sub" style="margin-top:4px"><b>No saved posts yet.</b><br>In your feed, press <b>☆ Save post</b> under a post. Claude then tells you if the author fits one of your ICPs, and what to comment or write.</div>
        ${location.pathname.startsWith("/feed") ? "" : `<div class="row"><a href="https://www.linkedin.com/feed/">Open the feed ›</a></div>`}`;
      return;
    }
    panel.innerHTML = `<div class="row" style="margin:0 0 4px;justify-content:space-between"><span class="muted" style="font-size:12px">${list.length} saved${todo ? ` · ${todo} not reviewed` : ""} · best fit first</span>
        <button class="mini" id="postsDash" data-tip="All saved posts on a full page, with Review all and Copy for Claude Code">Full page ↗</button></div>
      ${list.map((p) => {
        const rv = p.review;
        const icp = rv && icpName(rv.icp);
        const busy = postReviewing.has(p.id);
        const fitCls = !rv ? "" : rv.fit >= 7 ? "hi" : rv.fit <= 3 ? "lo" : "";
        return `<div class="pc" data-pid="${esc(p.id)}">
          <div class="l1"><a class="au" href="${esc(postHref(p))}" data-tip="${esc(p.url ? "Open the post on LinkedIn" : "Open " + (p.author.name || "the author") + "'s recent posts (this one was bookmarked before links were kept)")}">${esc(p.author.name || "Unknown")}</a>
            ${rv ? `<span class="fit ${fitCls}" data-tip="${esc((icp ? `Fits ICP ${icp.rank}: ${icp.name}` : "Fits none of your ICPs") + `\nScore ${rv.fit}/10, judged by Claude from the post`)}">${icp ? "ICP " + icp.rank + " · " : ""}${rv.fit}/10</span>` : ""}</div>
          <a class="tx" href="${esc(postHref(p))}" style="color:inherit;text-decoration:none;font-size:12px" data-tip="${esc(p.text.slice(0, 600))}">${esc(p.text)}</a>
          ${rv ? `<div class="rv"><b>${esc(rv.summary)}</b><br>${esc(rv.why)}</div>` : ""}
          <div class="acts2">
            ${rv ? `${rv.comment ? `<button class="mini" data-copy="${esc(rv.comment)}" data-tip="${esc("Comment you could leave:\n" + rv.comment)}">Copy comment</button>` : ""}${rv.message ? `<button class="mini" data-copy="${esc(rv.message)}" data-tip="${esc("First message:\n" + rv.message)}">Copy message</button>` : ""}`
              : `<button class="mini ok" data-rev ${busy ? "disabled" : ""}>${busy ? "Claude is reading…" : "Review with Claude"}</button>`}
            ${p.contactId ? `<span class="muted">in contacts ✓</span>` : /linkedin\.com\/in\//.test(p.author.url || "") && rv ? `<button class="mini" data-addp data-tip="Save the author to Contacts with the ICP, the post and Claude's reason">+ Contacts</button>` : ""}
            <button class="mini" data-delp data-tip="Remove from saved posts">×</button>
          </div>
          ${errFor === p.id ? `<div class="err">${esc(errMsg)}${/API key/.test(errMsg) ? ` <button class="link" id="opts">Open settings</button>` : ""}</div>` : ""}
        </div>`;
      }).join("")}`;
    $("postsDash").onclick = () => send("openDashboard", { page: "posts" });
    $("opts")?.addEventListener("click", () => send("openOptions"));
    panel.querySelectorAll(".pc").forEach((el) => {
      const id = el.dataset.pid;
      el.querySelector("[data-rev]")?.addEventListener("click", async () => {
        postReviewing.add(id); renderPostsView();
        const r = await send("reviewPost", { id });
        postReviewing.delete(id);
        const { posts = [] } = await chrome.storage.local.get("posts"); postsCache = posts;
        r?.ok ? renderPostsView() : renderPostsView(id, r?.error || "Review failed");
      });
      el.querySelector("[data-addp]")?.addEventListener("click", async (e) => {
        e.target.disabled = true;
        const r = await send("postAuthorToContacts", { id });
        if (!r?.ok) return renderPostsView(id, r?.error || "Could not add");
        await loadIndex();
      });
      el.querySelector("[data-delp]")?.addEventListener("click", () => send("unsavePost", { id }));
      el.querySelectorAll("[data-copy]").forEach((b) => b.onclick = async () => { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied ✓"; });
    });
  }

  // ── Today tab: goals, streak, who next ──
  async function renderTodayView() {
    panel.innerHTML = `<div class="muted">Loading…</div>`;
    const r = await send("rhythm");
    if (view !== "today") return;
    if (!r?.ok) return showError(r?.error || "Could not load");
    const { goals, days, today, toReach, toReview } = r.data;
    const t = days[today] || { reach: 0, follow: 0, review: 0 };
    const met = (d) => d && d.reach >= goals.reach && d.follow >= goals.follow;
    let streak = 0;
    for (let d = new Date(today + "T12:00:00"); ; d.setDate(d.getDate() - 1)) {
      const k = d.toISOString().slice(0, 10);
      if (met(days[k])) streak++;
      else if (k !== today) break;
    }
    const mins = Math.round(Object.values(t.time || {}).reduce((a, b) => a + b, 0) / 60);
    const step = (n, label, done, g, body) => `<div class="goal"><div class="gl"><span style="color:#fff;background:#5e5ce6;border-radius:50%;width:18px;height:18px;display:inline-grid;place-items:center;font-size:11px;margin-right:6px">${n}</span><b style="flex:1;color:#1d1d1f">${label}</b><span>${done} / ${g} today${done >= g ? " ✓" : ""}</span></div><div class="bar"><i class="${done >= g ? "done" : ""}" style="width:${Math.min(100, g ? (done / g) * 100 : 0)}%"></i></div>${body}</div>`;
    const next = toReach.slice(0, 3);
    panel.innerHTML = `<div class="streak"><b>${streak}</b> day streak${mins ? ` · ${mins} min on LinkedIn today` : ""}</div>
      <div class="goal"><div class="gl"><b style="flex:1;color:#1d1d1f">💬 Every day: comment on relevant posts</b><span>${t.comment || 0} / ${goals.comment ?? 3}${(t.comment || 0) >= (goals.comment ?? 3) ? " ✓" : ""}</span></div><div class="bar"><i class="${(t.comment || 0) >= (goals.comment ?? 3) ? "done" : ""}" style="width:${Math.min(100, ((t.comment || 0) / (goals.comment || 3)) * 100)}%;background:#30b0c7"></i></div><div class="t muted" style="margin-top:3px">Posts marked 💬 Relevant in your feed.</div></div>
      ${step(1, "Pick people", t.review, goals.review, `<div class="t muted" style="margin-top:4px">${toReview ? `${toReview} people Claude found are waiting. <button class="link" id="pickDash">Pick ›</button>` : "Nobody waiting."}</div>`)}
      ${step(2, "Reach out", t.reach, goals.reach, next.length ? next.map((p) => `<div class="person"><a class="n" href="${esc(p.linkedin)}">${esc(p.name)}</a><div class="t">${esc(p.why || [p.title, p.company].filter(Boolean).join(" · "))}</div></div>`).join("") + `<div class="t muted">Open them, press Connect. <button class="link" id="reachDash">All ›</button></div>` : `<div class="t muted">Nobody ready. Pick people first.</div>`)}
      ${step(3, "Follow up", t.follow, goals.follow, dueList.length ? dueBlock(5).replace(/<div class="h">[^<]*<\/div>/, "").replace('<div class="sec">', "<div>") + (dueList.length > 5 ? `<div class="t muted">${dueList.length - 5} more due. <button class="link" id="followDash">All ›</button></div>` : "") : `<div class="t muted">Nobody is due.</div>`)}
      <div class="row"><button class="mini" id="todayDash" data-tip="The full page: each step, results, your 12-month grid">Open the full page ↗</button></div>`;
    $("pickDash")?.addEventListener("click", () => send("openDashboard", { page: "pick" }));
    $("reachDash")?.addEventListener("click", () => send("openDashboard", { page: "reach" }));
    $("followDash")?.addEventListener("click", () => send("openDashboard", { page: "follow" }));
    $("todayDash").onclick = () => send("openDashboard", { page: "today" });
    wireDue(render);
  }

  function renderSent() {
    const rows = readSentInvites();
    const missing = rows.filter((r) => !index[r.slug]?.reasonSaved);
    panel.innerHTML = `<div class="top"><h3>Sent invitations</h3>${closeBtn()}</div>
      <div class="sub">${rows.length} shown${missing.length ? ` · ${missing.length} without a reason` : " · all have a reason"}. Scroll the page to load more.</div>
      <span class="lbl">Campaign for the ones you save here</span>
      <input type="text" id="campaign" placeholder="optional · click for suggestions" value="${esc(lastCampaign)}">
      ${rows.map((r) => {
        const k = index[r.slug];
        return `<div class="person">
          <a class="n" href="${esc(r.url)}">${esc(r.name)}</a> ${k ? `<span class="chip ok">in contacts</span>` : ""}
          <div class="t">${esc(r.title)}${r.sent ? " · " + esc(r.sent) : ""}</div>
          ${k?.reasonSaved
            ? `<div class="why">${esc(k.why)}</div>`
            : `<form data-slug="${esc(r.slug)}"><input type="text" placeholder="Why did you ask?" ${k?.why ? `title="${esc(k.why)}"` : ""}><button>Save</button></form>`}
        </div>`;
      }).join("")}`;
    wireClose();
    wireSuggest();
    panel.querySelectorAll("form[data-slug]").forEach((f) => {
      f.onsubmit = async (e) => {
        e.preventDefault();
        const reason = clean(f.querySelector("input").value);
        if (!reason) return;
        const r = rows.find((x) => x.slug === f.dataset.slug);
        f.querySelector("button").disabled = true;
        const campaign = clean($("campaign")?.value);
        if (campaign) { lastCampaign = campaign; chrome.storage.local.set({ lastCampaign }); }
        const res = await send("save", { url: r.url, name: r.name, title: r.title, reason, campaign, kind: "requested", remind: false });
        if (!res.ok) { f.querySelector("button").disabled = false; f.insertAdjacentHTML("afterend", `<div class="err">${esc(res.error)}</div>`); return; }
        await loadIndex();
        renderSent();
      };
    });
  }

  function showError(msg) {
    panel.innerHTML = `<div class="err">${esc(msg)}</div>
      <div class="row"><button class="link" id="opts">Open settings</button></div>`;
    wireClose();
    $("opts").onclick = () => send("openOptions");
  }

  // Reason + campaign + how the outreach happened. Read back with readOutreach().
  const connectBlock = (asked, label, kind = asked ? "requested" : "") => `
    <div class="sec"><div class="h">${label}</div>
      <textarea id="reason" placeholder="e.g. runs an AI agency on E2B; ask how they host client sandboxes"></textarea>
      <span class="lbl">Who they are</span>
      <div class="seg small" id="icpPick">${(self.ICPS || []).map((i) => `<button data-icp="${i.id}" data-tip="${esc(i.person)}">${esc(i.short)}</button>`).join("")}</div>
      <span class="lbl">When they accept, say</span>
      <textarea id="sayLater" placeholder="The first message you'll send. It pops up when they accept, so you don't forget."></textarea>
      <span class="lbl">What you're offering them</span>
      <div class="seg small" id="offerPick">${offersList.map((o, i) => `<button data-offer="${esc(o.id)}" class="${i === 0 ? "on" : ""}" data-tip="${esc(o.pitch || o.name)}">${esc(o.name)}</button>`).join("")}<button id="newOfferBtn" data-tip="Add an offer: a name and one line on what they get">+ New offer</button></div>
      <div id="newOffer" hidden><input type="text" id="offerName" placeholder="Name, e.g. Cerver Agents for agencies"><input type="text" id="offerPitch" placeholder="One line: what they get" style="margin-top:4px"><button class="mini ok" id="offerSave" style="margin-top:4px">Add offer</button></div>
      <div class="seg" id="kind">
        <button data-k="requested" class="${kind === "requested" ? "on" : ""}">Asked to connect</button><button data-k="message" class="${kind === "message" ? "on" : ""}">Messaged</button><button data-k="inbound" class="${kind === "inbound" ? "on" : ""}">They reached out</button>
      </div>
      <div class="row"><label><input type="checkbox" id="remind" ${asked ? "checked" : ""}> Remind me in 7 days</label></div>
    </div>`;
  function wireSuggest() {
    attachSuggest($("campaign"), () => campaigns);
    attachSuggest($("tags"), () => tagList, { multi: true });
    attachSuggest($("addTags"), () => tagList, { multi: true });
  }
  function wireOffers() {
    root.querySelectorAll("#offerPick [data-offer]").forEach((b) => b.onclick = () => {
      const on = !b.classList.contains("on");
      root.querySelectorAll("#offerPick [data-offer]").forEach((x) => x.classList.remove("on"));
      b.classList.toggle("on", on);
    });
    $("newOfferBtn")?.addEventListener("click", () => { $("newOffer").hidden = false; $("offerName").focus(); });
    $("offerSave")?.addEventListener("click", async () => {
      const r = await send("saveOffer", { name: $("offerName").value, pitch: $("offerPitch").value, icp: root.querySelector("#icpPick button.on")?.dataset.icp || null });
      if (!r.ok) return ($("offerName").placeholder = r.error);
      offersList = [r.data, ...offersList.filter((o) => o.id !== r.data.id)];
      root.querySelectorAll("#offerPick [data-offer]").forEach((x) => x.classList.remove("on"));
      $("newOfferBtn").insertAdjacentHTML("beforebegin", `<button data-offer="${esc(r.data.id)}" class="on" data-tip="${esc(r.data.pitch || r.data.name)}">${esc(r.data.name)}</button>`);
      $("newOffer").hidden = true;
      wireOffers();
    });
  }
  function wireKind() {
    wireSuggest();
    wireOffers();
    root.querySelectorAll("#icpPick button").forEach((b) => b.onclick = () => {
      const on = !b.classList.contains("on");
      root.querySelectorAll("#icpPick button").forEach((x) => x.classList.remove("on"));
      b.classList.toggle("on", on);
      // Picking who they are selects the offer made for them, if there is one.
      const match = on && offersList.find((o) => o.icp === b.dataset.icp);
      if (match) root.querySelectorAll("#offerPick [data-offer]").forEach((x) => x.classList.toggle("on", x.dataset.offer === match.id));
    });
    root.querySelectorAll("#kind button").forEach((b) => b.onclick = () => {
      const on = !b.classList.contains("on");
      root.querySelectorAll("#kind button").forEach((x) => x.classList.remove("on"));
      b.classList.toggle("on", on);
    });
  }
  function readOutreach() {
    const campaign = clean($("campaign")?.value);
    if (campaign) { lastCampaign = campaign; chrome.storage.local.set({ lastCampaign }); }
    return {
      reason: clean($("reason")?.value),
      icp: root.querySelector("#icpPick button.on")?.dataset.icp || "",
      offer: root.querySelector("#offerPick [data-offer].on")?.dataset.offer || "",
      sayLater: ($("sayLater")?.value || "").trim(),
      campaign,
      kind: root.querySelector("#kind button.on")?.dataset.k || null,
      remind: Boolean($("remind")?.checked),
    };
  }

  // ── Drafting with Claude (0.6) ──────────────────────────────────────
  const draftBlock = (label) => `<div class="sec"><div class="h">${label}</div>
      <div class="row" style="margin-top:0"><button class="mini" id="draftBtn" data-tip="Claude writes it from their profile, your reason, the campaign pitch and your About-you. You review before sending.">✎ Draft with Claude</button><span id="draftMsg" class="muted"></span></div>
      <div id="draftOut" hidden class="draft"><textarea id="draftText" rows="5"></textarea>
        <div class="row"><span class="count" id="draftCount"></span><button class="mini ok" id="draftInsert" data-tip="Puts the text into LinkedIn's note or message box. Nothing is sent.">Insert into LinkedIn</button><button class="mini" id="draftCopy">Copy</button><button class="mini" id="draftAgain" data-tip="Write a different version">Again</button></div></div></div>`;

  // Puts text into LinkedIn's connect-note box (pressing "Add a note" if
  // needed) or the open message box.
  async function writeMessage(text) {
    const box = () => [...document.querySelectorAll('.msg-form__contenteditable, [role="textbox"][contenteditable="true"]')].filter((e) => e.offsetParent && !host.contains(e)).at(-1);
    let ed = box();
    if (!ed) {
      const btn = [...document.querySelectorAll("main button, main a")].find((b) => /^Message\b/.test(clean(b.innerText)) || /^Message /.test(b.getAttribute("aria-label") || ""));
      if (btn) { btn.click(); for (let i = 0; i < 20 && !(ed = box()); i++) await sleep(150); }
    }
    if (!ed) return false;
    ed.focus();
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, text);
    return true;
  }
  async function insertIntoLinkedIn(text) {
    const noteBox = () => document.querySelector('[role=dialog] textarea, .artdeco-modal textarea');
    let ta = noteBox();
    if (!ta) {
      const add = [...document.querySelectorAll("[role=dialog] button, .artdeco-modal button")].find((b) => /Add a note/i.test(clean(b.innerText) + " " + (b.getAttribute("aria-label") || "")));
      if (add) { add.click(); for (let i = 0; i < 10 && !(ta = noteBox()); i++) await sleep(150); }
    }
    if (ta) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, text);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.focus();
      return "Put into the connection note. Check it, then press Send.";
    }
    const ed = document.querySelector('.msg-form__contenteditable[contenteditable="true"], [role=dialog] div[role=textbox][contenteditable="true"], div.msg-form__contenteditable');
    if (ed) {
      ed.focus();
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, text);
      return "Put into the message box. Check it, then send.";
    }
    return null;
  }

  // ctx() returns { kind, person, reason, campaign, notes, thread } at click time.
  function wireDraft(ctx) {
    if (!$("draftBtn")) return;
    const count = () => {
      const { kind } = ctx();
      const n = $("draftText").value.length;
      $("draftCount").textContent = kind === "note" ? `${n}/300` : `${n} chars`;
      $("draftCount").className = "count" + (kind === "note" && n > 300 ? " over" : "");
    };
    const run = async () => {
      $("draftBtn").disabled = true;
      $("draftMsg").textContent = "Drafting…";
      const r = await send("draft", ctx());
      $("draftBtn").disabled = false;
      if (!r.ok) {
        $("draftMsg").innerHTML = `<span class="err">${esc(r.error)}</span>${/Anthropic API key/.test(r.error) ? ` <button class="link" id="draftOpts">Settings</button>` : ""}`;
        $("draftOpts")?.addEventListener("click", () => send("openOptions"));
        return;
      }
      $("draftMsg").textContent = "";
      $("draftOut").hidden = false;
      $("draftText").value = r.data.text;
      count();
    };
    $("draftBtn").onclick = run;
    $("draftAgain").onclick = run;
    $("draftText").addEventListener("input", count);
    $("draftCopy").onclick = async () => { await navigator.clipboard.writeText($("draftText").value); $("draftMsg").textContent = "Copied."; };
    $("draftInsert").onclick = async () => {
      const m = await insertIntoLinkedIn($("draftText").value);
      $("draftMsg").textContent = m || "No note or message box open. Press Connect (or open the chat), then Insert again; or Copy.";
    };
  }

  // ── Messaging threads (0.5) ─────────────────────────────────────────
  function readThread() {
    const bar = document.querySelector(".msg-title-bar");
    if (!bar) return null;
    const a = bar.querySelector('a[href*="/in/"]');
    const name = clean((bar.querySelector("h2") || a || bar).innerText).split(/\s{2,}|\n/)[0];
    if (!name) return null;
    const hit = Object.entries(index).find(([, p]) => sameName(p.name, name));
    const slug = hit ? hit[0] : slugOf(a?.href);
    if (!slug) return null;
    return { slug, url: profileUrl(slug), name: hit ? hit[1].name : name, participant: name, title: "", company: "", degree: "", location: "", thread: true };
  }
  function readMessages() {
    const out = [];
    let sender = "";
    document.querySelectorAll("li.msg-s-message-list__event").forEach((li) => {
      const n = li.querySelector(".msg-s-message-group__name");
      if (n) sender = clean(n.innerText);
      li.querySelectorAll(".msg-s-event-listitem__body").forEach((b) => { const t = clean(b.innerText); if (t) out.push({ sender, text: t }); });
    });
    return out;
  }
  const threadText = (msgs, who) => msgs.slice(-14).map((m) => `${sameName(m.sender, who) ? "Them" : "Me"}: ${m.text}`).join("\n");

  // Same name as someone saved without a LinkedIn link: one click links them.
  function renderCandidate(k) {
    const t = target;
    panel.innerHTML = `<div class="top"><h3>${esc(t.name)}</h3></div>
      <div class="sub">Is this the ${esc(k.name)} already in your contacts?</div>
      <div class="person"><b>${esc(k.name)}</b>${k.suggested ? ` <span class="chip req" data-tip="Claude suggested them. Still waiting in step 1, Pick">suggested</span>` : ""}${k.icp ? ` <span class="chip stage">${esc(k.icp)}</span>` : ""}
        <div class="t">${esc([k.title, k.company].filter(Boolean).join(" · "))}</div>
        ${k.evidence ? `<div class="why" style="margin-top:6px"><b>What we found:</b> ${esc(k.evidence)}</div>` : k.why ? `<div class="why" style="margin-top:6px">${esc(k.why)}</div>` : ""}</div>
      <button class="go" id="linkYes">Yes, this is them</button>
      <div class="row"><button class="link" id="linkNo">No, someone else</button></div><div id="msg"></div>`;
    $("linkYes").onclick = async () => {
      $("linkYes").disabled = true;
      const r = await send("linkProfile", { id: k.id, url: t.url });
      if (!r.ok) { $("linkYes").disabled = false; return ($("msg").innerHTML = `<div class="err">${esc(r.error)}</div>`); }
      flash = "Linked to their LinkedIn.";
      await loadIndex();
      r.data.found ? renderKnown(r.data) : renderNew();
    };
    $("linkNo").onclick = () => renderNew();
  }

  function renderNew() {
    const t = target;
    const asking = mode === "connect" || mode === "preconnect" || t.pending;
    panel.innerHTML = `<div class="top"><h3>${esc(t.name || "This person")}</h3>${closeBtn()}</div>
      <div class="sub">${esc([t.degree, t.location].filter(Boolean).join(" · "))}${t.degree || t.location ? " · " : ""}not in your contacts</div>
      <details ${mode === "preconnect" ? "" : "open"}><summary class="muted" style="cursor:pointer">${esc([t.title, t.company].filter(Boolean).join(" · ") || "Details")}</summary>
      <span class="lbl">Name</span><input type="text" id="name" value="${esc(t.name)}">
      <span class="lbl">Title</span><input type="text" id="title" value="${esc(t.title)}">
      <span class="lbl">Company</span><input type="text" id="company" value="${esc(t.company)}">
      <span class="lbl">Tags (comma separated)</span><input type="text" id="tags" placeholder="click for suggestions"></details>
      ${connectBlock(asking, t.degree === "1st" ? "Why they matter to you" : t.pending ? "You asked to connect. Why?" : "Why do you want to connect?", asking ? "requested" : "")}
      <button class="go" id="save">${mode === "preconnect" ? "Connect on LinkedIn" : asking ? "Save the request and the reason" : "Add to contacts"}</button>
      ${mode === "preconnect" ? `<div class="row"><button class="link" id="plainConnect" data-tip="Send the request without saving anything">Connect without saving</button></div>` : ""}
      <div id="msg"></div>
      ${draftBlock(t.degree === "1st" || t.thread ? "Message" : "Connection note")}`;
    wireClose();
    $("plainConnect")?.addEventListener("click", async () => { mode = "auto"; t.pending = true; await pressConnect(); render(); });
    wireKind();
    wireDraft(() => ({
      kind: t.thread ? "reply" : t.degree === "1st" ? "message" : "note",
      person: { name: clean($("name")?.value) || t.name, title: clean($("title")?.value), company: clean($("company")?.value), location: t.location },
      reason: clean($("reason")?.value),
      campaign: clean($("campaign")?.value),
      offer: root.querySelector("#offerPick [data-offer].on")?.dataset.offer || "",
      thread: t.thread ? threadText(readMessages(), t.participant) : "",
    }));
    if (asking) $("reason").focus();
    $("save").onclick = async () => {
      const name = clean($("name").value);
      if (!name) return ($("msg").innerHTML = `<div class="err">A name is needed.</div>`);
      $("save").disabled = true;
      const first = t.degree === "1st";
      const r = await send("save", {
        url: t.url,
        name,
        title: clean($("title").value),
        company: clean($("company").value),
        tags: $("tags").value.split(",").map(clean).filter(Boolean).concat(first ? ["linkedin:connected"] : []),
        ...readOutreach(),
      });
      if (!r.ok) { $("save").disabled = false; return ($("msg").innerHTML = `<div class="err">${esc(r.error)}</div>`); }
      const wasHeld = mode === "preconnect";
      mode = "auto";
      flash = "Added.";
      if (wasHeld) { t.pending = true; flash = (await pressConnect()) ? "Saved, and the request went to LinkedIn. If LinkedIn asks to add a note, that's your call." : "Saved. Press Connect on LinkedIn again to send the request."; }
      await loadIndex();
      renderKnown(r.data);
    };
  }

  function renderKnown({ contact: c, interactions }) {
    const t = target;
    const connectedNow = t.degree === "1st" || c.connected;
    const asking = mode === "connect" || mode === "preconnect" || (t.pending && !c.requested);
    const reasons = c.reasons.map((w) => `<div class="why">${esc(w.text)}${w.date ? `<div class="d">${esc(w.date)}</div>` : ""}</div>`).join("");
    const notesRest = c.notes.split("\n").filter((l) => !/^(Why connect|Say when they accept)/.test(l)).join("\n").trim();
    const minor = c.tags.filter((t2) => !/^(stage:|linkedin:)/.test(t2));
    panel.innerHTML = `<div class="top"><h3>${esc(c.name)}</h3>${closeBtn()}</div>
      <div class="sub">${esc([c.title, c.company].filter(Boolean).join(" · "))}</div>
      <div class="chips">
        <span class="chip ok">In contacts</span>
        ${c.stage ? `<span class="chip stage">${esc(c.stage)}</span>` : ""}
        ${connectedNow ? `<span class="chip">connected</span>` : c.requested ? `<span class="chip req">asked to connect</span>` : ""}
        ${(c.icps || []).map((i) => `<span class="chip stage" data-tip="${esc(i.person)}">${esc(i.short)}</span>`).join("")}
        ${minor.slice(0, 3).map((x) => `<span class="chip">${esc(x)}</span>`).join("")}${minor.length > 3 ? `<span class="chip" title="${esc(minor.slice(3).join(", "))}">+${minor.length - 3}</span>` : ""}
      </div>
      ${flash ? `<div class="ok-msg">${esc(flash)}</div>` : ""}
      <div class="seg small" id="stage">${STAGES.map((st) => `<button data-s="${st}" class="${c.stage === st ? "on" : ""}" data-tip="${c.stage === st ? "Current stage. Click to clear it." : `Move to stage “${st}”`}">${st}</button>`).join("")}</div>
      ${t.thread ? `<div class="sec"><div class="h">This conversation</div><div id="lastMsg"></div>
        <div class="row" style="margin-top:2px"><button class="mini ok" id="logLast" data-tip="Saves the newest message in this chat to their history">Log last message</button>${c.replied ? `<span class="chip ok">replied</span>` : ""}</div></div>` : ""}
      ${c.sayLater ? `<div class="sec"><div class="h">${connectedNow ? "They're connected. Send this" : "When they accept, say"}</div>
        <div class="why" style="${connectedNow ? "background:#e3f9e9;border-left-color:#34c759" : ""}" dir="auto">${esc(c.sayLater)}</div>
        <div class="row" style="margin-top:2px"><button class="mini ok" id="sayCopy">Copy</button>${connectedNow ? `<button class="mini" id="sayInsert" data-tip="Opens a message to them and puts the text in. Nothing is sent.">Write it in a message</button>` : ""}</div></div>` : ""}
      ${reasons ? `<div class="sec"><div class="h">Why you wanted to connect</div>${reasons}</div>` : ""}
      ${notesRest ? `<div class="sec"><div class="h">Notes</div><div class="notes" id="notes">${esc(notesRest)}</div>${notesRest.length > 260 ? `<button class="link" id="more">Show all</button>` : ""}</div>` : ""}
      ${c.followUpAt ? `<div class="sec fu">Follow up <b class="${c.followUpAt.slice(0, 10) < todayStr() ? "late" : ""}">${esc(c.followUpAt.slice(0, 10))}</b>${c.followUpNote ? ": " + esc(c.followUpNote) : ""}
        <div class="row"><button class="mini ok" id="fuDone" data-tip="You followed up: clears the reminder and logs it">Done</button><button class="mini" id="fuSnooze" data-tip="Remind me again in 3 days">+3 days</button><button class="mini" id="clearFu" data-tip="Remove the reminder without logging anything">Clear</button></div></div>` : ""}

      ${asking || (!connectedNow && !c.requested && !reasons)
        ? connectBlock(asking, t.pending ? "You asked to connect. Why?" : "Why do you want to connect?", asking ? "requested" : "") + `<button class="go" id="saveReason">${mode === "preconnect" ? "Connect on LinkedIn" : "Save"}</button>${mode === "preconnect" ? `<div class="row"><button class="link" id="plainConnect">Connect without saving</button></div>` : ""}`
        : `<div class="row"><button class="link" id="addReason">+ Add a reason or campaign</button></div><div id="reasonSlot"></div>`}

      ${draftBlock(t.thread ? "Reply" : connectedNow ? "Message" : "Connection note")}
      <div class="sec"><div class="h">Log</div>
        <div class="seg" id="chan">
          <button data-c="message" class="on">Messaged</button><button data-c="meeting">Met</button><button data-c="call">Call</button><button data-c="note">Note</button>
        </div>
        <textarea id="logText" placeholder="What happened, what to remember"></textarea>
        <div class="row">Next follow-up:
          <span class="seg" id="fu"><button data-d="">none</button><button data-d="3">3 days</button><button data-d="7">1 week</button><button data-d="14">2 weeks</button></span>
        </div>
        <button class="go" id="saveLog">Save</button>

      </div>
      <div id="msg"></div>
      ${interactions.length ? `<div class="sec hist"><div class="h">History</div>${interactions.map((i) => `<div><span class="muted">${esc((i.occurredAt || "").slice(0, 10))} · ${esc(i.channel)}</span><br>${esc(i.summary)}</div>`).join("")}</div>` : ""}
      <div class="sec"><div class="h">Tags</div><div class="row" style="margin-top:0"><input type="text" id="addTags" placeholder="add tags · click for suggestions" style="flex:1;width:auto"><button class="mini" id="addTagsBtn">Add</button></div></div>
      <div class="row"><a href="${esc(c.appUrl)}" target="_blank" rel="noopener">Open in Contacts ↗</a></div>`;
    flash = "";
    $("sayCopy")?.addEventListener("click", async (e) => { await navigator.clipboard.writeText(c.sayLater); e.target.textContent = "Copied ✓"; });
    $("sayInsert")?.addEventListener("click", async (e) => { e.target.disabled = true; const ok = await writeMessage(c.sayLater); e.target.textContent = ok ? "In the message box ✓" : "Open their Message box first"; e.target.disabled = false; });
    wireClose();
    $("more")?.addEventListener("click", () => { $("notes").classList.add("open"); $("more").remove(); });
    if (asking) $("reason")?.focus();
    wireKind();
    wireDraft(() => ({
      kind: t.thread ? "reply" : connectedNow ? "message" : "note",
      person: { name: c.name, title: c.title || t.title, company: c.company || t.company, location: t.location },
      reason: clean($("reason")?.value) || c.reasons[0]?.text || "",
      campaign: clean($("campaign")?.value) || c.campaigns[0] || "",
      notes: notesRest,
      thread: t.thread ? threadText(readMessages(), t.participant) : "",
    }));

    let channel = "message";
    let days = "";
    root.querySelectorAll("#chan button").forEach((b) => b.onclick = () => {
      channel = b.dataset.c;
      root.querySelectorAll("#chan button").forEach((x) => x.classList.toggle("on", x === b));
    });
    root.querySelectorAll("#fu button").forEach((b) => b.onclick = () => {
      days = b.dataset.d;
      root.querySelectorAll("#fu button").forEach((x) => x.classList.toggle("on", x === b));
    });
    root.querySelector('#fu button[data-d=""]').classList.add("on");

    const fail = (btn, r) => { btn.disabled = false; $("msg").innerHTML = `<div class="err">${esc(r.error)}</div>`; };
    const done = async (data, msg) => { mode = "auto"; flash = msg; await loadIndex(); renderKnown(data); };

    $("addReason")?.addEventListener("click", () => {
      $("addReason").remove();
      $("reasonSlot").innerHTML = connectBlock(false, "Reason / campaign") + `<button class="go" id="saveReason">Save</button>`;
      wireKind();
      $("reason").focus();
      $("saveReason").onclick = saveReason;
    });
    async function saveReason() {
      const btn = $("saveReason");
      btn.disabled = true;
      const held = mode === "preconnect";
      const r = await send("save", { url: t.url, name: c.name, ...readOutreach() });
      if (!r.ok) return fail(btn, r);
      if (held) { t.pending = true; mode = "auto"; return done(r.data, (await pressConnect()) ? "Saved, and the request went to LinkedIn." : "Saved. Press Connect on LinkedIn again to send the request."); }
      done(r.data, "Saved.");
    }
    $("plainConnect")?.addEventListener("click", async () => { mode = "auto"; t.pending = true; await pressConnect(); render(); });
    $("saveReason")?.addEventListener("click", saveReason);
    $("saveLog").onclick = async () => {
      const btn = $("saveLog");
      const text = clean($("logText").value);
      if (!text && !days) return;
      btn.disabled = true;
      let r = { ok: true, data: null };
      if (text) r = await send("note", { id: c.id, text, channel, url: t.url });
      if (r.ok && days) r = await send("followUp", { id: c.id, days: Number(days), note: text || "Follow up", url: t.url });
      r.ok ? done(r.data, days ? `Saved. Follow-up in ${days} days.` : "Saved.") : fail(btn, r);
    };
    root.querySelectorAll("#stage button").forEach((b) => b.onclick = async () => {
      const st = b.classList.contains("on") ? "" : b.dataset.s;
      b.disabled = true;
      const r = await send("setStage", { id: c.id, stage: st, url: t.url });
      r.ok ? done(r.data, st ? `Stage: ${st}.` : "Stage cleared.") : fail(b, r);
    });
    $("addTagsBtn")?.addEventListener("click", async () => {
      const tags = $("addTags").value.split(",").map(clean).filter(Boolean);
      if (!tags.length) return;
      const r = await send("addTags", { id: c.id, tags, url: t.url });
      r.ok ? done(r.data, "Tags added.") : fail($("addTagsBtn"), r);
    });
    if (t.thread) {
      const msgs = readMessages();
      const last = msgs.at(-1);
      const fromThem = last && sameName(last.sender, t.participant);
      $("lastMsg").innerHTML = last ? `<div class="msgprev"><b>${fromThem ? esc(t.participant.split(" ")[0]) : "You"}:</b> ${esc(last.text)}</div>` : `<div class="muted">No messages read yet.</div>`;
      if (!last) $("logLast").disabled = true;
      $("logLast").onclick = async () => {
        $("logLast").disabled = true;
        let r = await send("note", { id: c.id, channel: "message", url: t.url, text: `${fromThem ? "They wrote" : "I wrote"} on LinkedIn: ${last.text.slice(0, 600)}` });
        if (r.ok && fromThem && !c.replied) r = await send("replied", { id: c.id, url: t.url });
        r.ok ? done(r.data, "Message logged.") : fail($("logLast"), r);
      };
      // They have written in this thread: mark the contact as replied, once.
      if (!c.replied && msgs.some((m) => sameName(m.sender, t.participant)) && !repliedSeen.has(c.id)) {
        repliedSeen.add(c.id);
        send("replied", { id: c.id, url: t.url }).then((r) => { if (r.ok && target?.slug === t.slug) done(r.data, "They wrote back: marked as replied."); });
      }
    }
    $("fuDone")?.addEventListener("click", async () => {
      const r = await send("done", { id: c.id, url: t.url });
      r.ok ? done(r.data, "Marked as followed up.") : fail($("fuDone"), r);
    });
    $("fuSnooze")?.addEventListener("click", async () => {
      const r = await send("snooze", { id: c.id, days: 3, url: t.url });
      r.ok ? done(r.data, "Moved 3 days.") : fail($("fuSnooze"), r);
    });
    $("clearFu")?.addEventListener("click", async () => {
      const r = await send("followUp", { id: c.id, days: null, url: t.url });
      r.ok ? done(r.data, "Follow-up cleared.") : fail($("clearFu"), r);
    });
  }

  // ── Dots next to known people ───────────────────────────────────────
  function markKnown() {
    const here = slugOf(location.pathname);
    document.querySelectorAll('a[href*="/in/"]:not([data-ac-done])').forEach((a) => {
      a.setAttribute("data-ac-done", "1");
      const s = slugOf(a.href);
      const p = s && index[s];
      const text = clean(a.innerText);
      // A name link only: not the open profile, not "Contact info"-style
      // sub-pages, not photos, not long blocks.
      if (!p || s === here || /\/(overlay|detail|recent-activity)\//.test(a.href) || !text || text.length > 60 || a.querySelector("img")) return;
      const dot = document.createElement("span");
      dot.textContent = "●";
      dot.title = `In your contacts${p.why ? ": " + p.why : ""}${p.requested ? " (asked to connect)" : ""}`;
      dot.style.cssText = `color:${p.requested ? "#f59e0b" : "#22c55e"};font-size:9px;margin-left:4px;vertical-align:middle;`;
      a.appendChild(dot);
    });
  }

  // ── Inline bars under people on list pages ──────────────────────────
  // Grow, search results, invitations, "people you may know": wherever a
  // person card has Connect / Accept / Pending / Message, put a one-line
  // bar under the name: what you know (tags, why), or a quick save.
  const CARD_BTN = /^(Connect|Accept|Pending|Message|Follow)$/;
  const CARD_ARIA = /^(Invite .+ to connect|Accept .+invitation|Ignore an invitation|Pending)/i;

  function cardsOnPage() {
    const out = [];
    const main = document.querySelector("main");
    // Only people lists (Grow, invitations, people search). Not the feed,
    // profiles or chats: there the bar lands on top of names.
    if (!main || !/^\/(mynetwork|search\/results\/people)/.test(location.pathname)) return out;
    main.querySelectorAll('button, a[role=button], a[href*="custom-invite"], a[aria-label]').forEach((b) => {
      if (!CARD_BTN.test(clean(b.innerText)) && !CARD_ARIA.test(b.getAttribute("aria-label") || "")) return;
      let card = b.parentElement;
      for (let i = 0; i < 12 && card && !card.querySelector('a[href*="/in/"]'); i++) card = card.parentElement;
      // One bar per person: Accept and Ignore can each find a different
      // wrapper of the same card.
      if (!card || card.hasAttribute("data-ac-card") || card.closest("[data-ac-card]") || card.querySelector("[data-ac-card], [data-ac-bar]")) return;
      const slugs = new Set([...card.querySelectorAll('a[href*="/in/"]')].map((a) => slugOf(a.href)).filter(Boolean));
      if (slugs.size !== 1) return;
      const nameLink = [...card.querySelectorAll('a[href*="/in/"]')].find((a) => clean(a.innerText));
      if (!nameLink) return;
      const label = clean(b.innerText) + " " + (b.getAttribute("aria-label") || "");
      const kind = /Accept|Ignore an invitation/i.test(label) ? "inbound" : /Pending/i.test(label) ? "requested" : "";
      const slug = [...slugs][0];
      const dup = out.findIndex((o) => o.slug === slug);
      if (dup >= 0) {
        // Keep the tighter wrapper; an inbound request wins over a plain one.
        if (out[dup].card.contains(card)) out[dup] = { ...out[dup], card, nameLink };
        if (kind === "inbound") out[dup].kind = "inbound";
        return;
      }
      out.push({ card, nameLink, slug, kind });
    });
    return out;
  }

  function decorateCards() {
    for (const { card, nameLink, slug, kind } of cardsOnPage()) {
      card.setAttribute("data-ac-card", "1");
      const lines = clean(nameLink.innerText) ? nameLink.innerText.split("\n").map(clean).filter(Boolean) : [];
      const person = { slug, url: profileUrl(slug), name: (lines[0] || "").replace(/\s*(wants to connect|●)\s*$/i, ""), title: lines[1] || "" };
      const bar = document.createElement("div");
      bar.setAttribute("data-ac-bar", "1");
      bar.style.cssText = "margin-top:4px;";
      const sr = bar.attachShadow({ mode: "open" });
      // Put it under the text column, not as a new flex column of the card.
      let col = nameLink;
      while (col.parentElement && col.parentElement !== card) col = col.parentElement;
      if (col === nameLink || col.tagName === "A") col.after(bar); else col.appendChild(bar);
      // Never inside a link: clicks in the bar would open the profile.
      let a = bar.parentElement?.closest("a");
      while (a) { a.after(bar); a = bar.parentElement?.closest("a"); }
      paintBar(sr, person, kind);
    }
  }

  function paintBar(sr, person, kind) {
    const k = index[person.slug];
    const css = `<style>
      * { box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
      .b { display:flex; align-items:center; gap:4px; flex-wrap:wrap; font-size:11.5px; color:#374151; }
      .c { padding:1px 7px; border-radius:999px; background:#f3f4f6; }
      .ok { background:#dcfce7; color:#166534; } .req { background:#fef3c7; color:#92400e; } .camp { background:#e0e7ff; color:#3730a3; }
      .why { color:#4b5563; max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      button { padding:2px 8px; border:1px solid #c7d2fe; background:#eef2ff; color:#3730a3; border-radius:999px; font-size:11.5px; cursor:pointer; }
      form { display:flex; gap:4px; flex-wrap:wrap; margin-top:4px; }
      input { padding:3px 6px; border:1px solid #d1d5db; border-radius:6px; font-size:12px; }
      input.r { flex:1; min-width:180px; } input.k { width:150px; }
      .err { color:#b91c1c; }
    </style>`;
    const stop = (el) => ["click", "mousedown", "keydown"].forEach((ev) => el.addEventListener(ev, (e) => e.stopPropagation()));
    if (k) {
      const shown = (k.tags || []).filter((t) => !t.startsWith("stage:"));
      const camp = shown.filter((t) => t.startsWith("campaign:")).map((t) => t.slice(9));
      const other = shown.filter((t) => !t.startsWith("campaign:"));
      sr.innerHTML = css + `<div class="b">
        <span class="c ${k.requested ? "req" : "ok"}">${k.requested ? "asked" : "in contacts"}</span>
        ${camp.map((t) => `<span class="c camp">${esc(t)}</span>`).join("")}
        ${other.slice(0, 2).map((t) => `<span class="c">${esc(t)}</span>`).join("")}
        ${k.why ? `<span class="why" title="${esc(k.why)}">${esc(k.why)}</span>` : `<button id="add">+ why</button>`}
      </div><div id="f"></div>`;
    } else {
      sr.innerHTML = css + `<div class="b">
        <button id="add">+ Save${kind === "inbound" ? " (they reached out)" : ""}</button>
      </div><div id="f"></div>`;
    }
    stop(sr.firstElementChild?.nextElementSibling || sr);
    const add = sr.getElementById("add");
    if (!add) return;
    add.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      sr.getElementById("f").innerHTML = `<form>
        <input class="r" placeholder="${kind === "inbound" ? "Why they reached out / who they are" : "Why this person?"}">
        <input class="k" placeholder="campaign" value="${esc(lastCampaign)}">
        <button>Save</button></form>`;
      const form = sr.querySelector("form");
      stop(form);
      attachSuggest(form.querySelector(".k"), () => campaigns);
      form.querySelector(".r").focus();
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const reason = clean(form.querySelector(".r").value);
        const campaign = clean(form.querySelector(".k").value);
        if (campaign) { lastCampaign = campaign; chrome.storage.local.set({ lastCampaign }); }
        form.querySelector("button").disabled = true;
        const r = await send("save", { url: person.url, name: k?.name || person.name, title: person.title, reason, campaign, kind: k ? null : kind || null });
        if (!r.ok) { form.insertAdjacentHTML("afterend", `<div class="err">${esc(r.error)}</div>`); form.querySelector("button").disabled = false; return; }
        const idx = await send("index");
        if (idx.ok) index = idx.data;
        paintBar(sr, person, kind);
      };
    };
  }

  async function loadIndex() {
    const r = await send("index");
    send("offers").then((o) => { if (o.ok) offersList = o.data; });
    send("campaigns").then((c) => { if (c.ok) campaigns = c.data; });
    send("tags").then((t) => { if (t.ok) tagList = t.data; });
    const d = await send("due");
    if (d.ok) dueList = d.data;
    if (r.ok) {
      index = r.data;
      document.querySelectorAll("[data-ac-bar]").forEach((b) => b.remove());
      document.querySelectorAll("[data-ac-card]").forEach((c) => c.removeAttribute("data-ac-card"));
      document.querySelectorAll("[data-ac-done]").forEach((a) => a.removeAttribute("data-ac-done"));
      markKnown();
      decorateCards();
    }
    return r;
  }

  // ── Following LinkedIn's single-page navigation ─────────────────────
  let lastPath = "";
  function onRoute() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    mode = "auto";
    target = null;
    if (onProfile()) {
      // Wait for LinkedIn to draw the name before reading the page.
      let tries = 0;
      const wait = setInterval(() => {
        const p = readProfile();
        if ((p && p.title) || ++tries > 12) {
          clearInterval(wait);
          if (slugOf(location.pathname) === p?.slug) { target = p; render(); }
        }
      }, 500);
    } else if (onThread()) {
      // Wait for the chat header, then match the person by name.
      let tries = 0;
      const wait = setInterval(() => {
        const p = readThread();
        if (p || ++tries > 12) {
          clearInterval(wait);
          if (p && onThread()) { target = p; render(); }
        }
      }, 500);
    } else {
      render();
    }
  }

  // ── Acceptances (0.4) ───────────────────────────────────────────────
  // On Notifications ("X accepted your invitation") and on the Connections
  // list, anyone you asked who shows up has accepted: record it once.
  let scanning = false;
  async function scanAcceptances() {
    const notif = location.pathname.startsWith("/notifications");
    const conns = location.pathname.startsWith("/mynetwork/invite-connect/connections");
    if (scanning || (!notif && !conns)) return;
    const hits = [];
    document.querySelectorAll('main a[href*="/in/"]').forEach((a) => {
      const s = slugOf(a.href);
      const k = s && index[s];
      if (!k || !k.requested || acceptedSeen.has(k.id)) return;
      if (notif) {
        let el = a;
        for (let i = 0; i < 8 && el && !/accepted your invitation/i.test(el.innerText || ""); i++) el = el.parentElement;
        if (!el || (el.innerText || "").length > 600) return;
      }
      acceptedSeen.add(k.id);
      hits.push({ id: k.id, url: profileUrl(s), name: k.name });
    });
    if (!hits.length) return;
    scanning = true;
    for (const h of hits) await send("accepted", { id: h.id, url: h.url });
    await loadIndex();
    scanning = false;
    $("tabText").textContent = `Recorded ${hits.length} acceptance${hits.length === 1 ? "" : "s"}`;
    $("tab").title = hits.map((h) => h.name).join(", ") + " accepted";
  }

  // Pressing "Connect" anywhere: hold it, open the panel on that person and
  // ask why, who they are and what you're offering. The panel's own Connect
  // button then saves it and presses LinkedIn's Connect for real.
  let allowConnect = false;      // true while the panel itself presses Connect
  let heldConnect = null;        // the Connect element that was held
  const connectElOf = (target) => {
    if (host.contains(target) || target.closest?.("[data-ac-bar]")) return null;
    const btn = target.closest?.('button, a[role=button], div[role=button], [role=menuitem], a[href*="custom-invite"]');
    if (!btn) return null;
    const aria = btn.getAttribute("aria-label") || "";
    return /^Invite .+? to connect/i.test(aria) || clean(btn.innerText) === "Connect" ? btn : null;
  };
  // LinkedIn may act on the press, not the click: hold those too.
  ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach((type) => document.addEventListener(type, (e) => {
    if (!allowConnect && e.isTrusted && connectElOf(e.target)) { e.stopImmediatePropagation(); e.stopPropagation(); }
  }, true));
  async function pressConnect() {
    allowConnect = true;
    try {
      const el = heldConnect;
      if (el?.isConnected && el.offsetParent) { press(el); return true; }
      if (!onProfile()) return false;
      // The menu closed: find Connect on the profile again (button, or More → Connect).
      const direct = [...document.querySelectorAll("main button, main a")].find((b) => b.offsetParent && (/^Invite .+ to connect/i.test(b.getAttribute("aria-label") || "") ? (b.getAttribute("aria-label") || "").includes(target?.name?.split(" ")[0] || "\u0000") : false));
      if (direct) { press(direct); return true; }
      const more = [...document.querySelectorAll("main button")].find((b) => b.offsetParent && clean(b.innerText) === "More");
      if (!more) return false;
      press(more);
      for (let i = 0; i < 20; i++) {
        await sleep(100);
        const mi = [...document.querySelectorAll('[role="menuitem"]')].find((m) => m.offsetParent && clean(m.innerText) === "Connect");
        if (mi) { press(mi); return true; }
      }
      return false;
    } finally { setTimeout(() => { allowConnect = false; }, 1500); }
  }
  document.addEventListener("click", (e) => {
    const btn = connectElOf(e.target);
    if (!btn || allowConnect) return;
    if (!e.isTrusted) return;
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
    heldConnect = btn;
    const aria = btn.getAttribute("aria-label") || "";
    const invite = aria.match(/^Invite (.+?) to connect/i);
    // Search results: the invite link carries the profile id (?vanityName=…).
    const vanity = (btn.getAttribute("href") || "").match(/vanityName=([^&]+)/);
    let person = null;
    if (vanity) {
      const s = `in/${decodeURIComponent(vanity[1]).toLowerCase()}`;
      let card = btn.parentElement;
      for (let i = 0; i < 10 && card && !card.querySelector?.(`a[href*="/${s}"]`); i++) card = card.parentElement;
      const name = invite ? clean(invite[1]) : clean([...(card?.querySelectorAll(`a[href*="/${s}"]`) || [])].map((a) => a.innerText).find((t) => clean(t)) || "").split("\n")[0];
      connectPerson = target = { slug: s, url: profileUrl(s), name: name || s, title: "", company: "", degree: "", location: "" };
      mode = "preconnect";
      view = "here";
      setOpen(true);
      return;
    }
    const prof = onProfile() ? readProfile() : null;
    if (prof && (!invite || clean(invite[1]) === prof.name)) {
      person = prof;
    } else {
      // A Connect button in a list: the person's link is in the same card.
      let card = btn.parentElement;
      let link = null;
      for (let i = 0; i < 10 && card && !link; i++, card = card.parentElement) link = card.querySelector?.('a[href*="/in/"]');
      const s = link && slugOf(link.href);
      if (s) person = { slug: s, url: profileUrl(s), name: invite ? clean(invite[1]) : clean(link.innerText).split("\n")[0], title: "", company: "", degree: "", location: "" };
    }
    if (!person) { // couldn't tell who: let LinkedIn's Connect go through
      heldConnect = btn; pressConnect();
      return;
    }
    connectPerson = person;
    target = person;
    mode = "preconnect";
    view = "here";
    setOpen(true);
  }, true);

  // LinkedIn's Send in the connect dialog: save the request and the note
  // typed in "Add a note", even if the panel isn't used.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.("button");
    if (!btn || !connectPerson) return;
    const dialog = btn.closest('[role=dialog], [role=alertdialog], .artdeco-modal');
    if (!dialog) return;
    const label = clean(btn.innerText) + " " + (btn.getAttribute("aria-label") || "");
    if (!/^\s*Send\b/i.test(label)) return;
    const note = clean(dialog.querySelector("textarea")?.value);
    const p = connectPerson;
    connectPerson = null;
    send("connectSent", { url: p.url, name: p.name, title: p.title || "", note }).then(async (r) => {
      await loadIndex();
      if (r.ok && target?.slug === p.slug && open) { flash = note ? "Request and your note saved." : "Request saved."; renderKnown(r.data); }
    });
  }, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "toggle") setOpen(!open);
  });

  // ── Saving posts ────────────────────────────────────────────────────
  // Every post has one Repost button; the post is the biggest box around it
  // that holds no other Repost button. The text is LinkedIn's
  // expandable-text-box; the author is the last profile/company link before it.
  let savedPosts = new Set();
  chrome.storage.local.get("posts").then(({ posts = [] }) => { savedPosts = new Set(posts.map((x) => x.id)); decoratePosts(); }).catch(() => {});
  chrome.storage.onChanged.addListener((ch) => { if (ch.posts) { savedPosts = new Set((ch.posts.newValue || []).map((x) => x.id)); repaintPostBars(); } });
  const hash = (t) => { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };

  const BOOKMARK = (on, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" style="display:block"><path d="M6.5 3.5h11a1 1 0 0 1 1 1v16.2l-6.5-4.4-6.5 4.4V4.5a1 1 0 0 1 1-1z" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  // LinkedIn's menus open on the full pointer sequence, not on a bare click().
  const press = (el) => {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true, view: window };
    el.dispatchEvent(new PointerEvent("pointerdown", o)); el.dispatchEvent(new MouseEvent("mousedown", o));
    el.dispatchEvent(new PointerEvent("pointerup", o)); el.dispatchEvent(new MouseEvent("mouseup", o)); el.dispatchEvent(new MouseEvent("click", o));
  };
  // The post's own link. If the page shows its id, use it; otherwise press
  // ••• → "Copy link to post" and catch the link in page-hook.js (the
  // clipboard is left alone).
  async function postLinkOf(rootEl) {
    if (/\/(feed\/update|posts)\//.test(location.pathname)) return location.href.split("?")[0];
    for (const n of [rootEl, ...rootEl.querySelectorAll("[componentkey], [id], [data-urn]")]) {
      for (const at of n.attributes || []) {
        const m = at.value.match(/urn:li:activity:(\d{10,})|\(activity:(\d{10,}),/);
        if (m) return `https://www.linkedin.com/feed/update/urn:li:activity:${m[1] || m[2]}/`;
      }
    }
    const menuBtn = rootEl.querySelector("button[aria-label^='Open control menu for post']");
    if (!menuBtn) return "";
    return new Promise((resolve) => {
      let done = false;
      const finish = (url) => {
        if (done) return; done = true;
        removeEventListener("message", onMsg);
        document.documentElement.dataset.acGrabLink = "";
        if (menuBtn.getAttribute("aria-expanded") === "true") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        resolve(url || "");
      };
      const onMsg = (e) => { if (e.source === window && e.data?.acPostLink) finish(e.data.acPostLink.split("?")[0]); };
      addEventListener("message", onMsg);
      document.documentElement.dataset.acGrabLink = "1";
      press(menuBtn);
      let tries = 0;
      const t = setInterval(() => {
        const mi = [...document.querySelectorAll('[role="menuitem"]')].find((e) => /Copy link to post/i.test(e.innerText || "") && e.offsetParent);
        if (mi) { clearInterval(t); press(mi); setTimeout(() => finish(""), 1500); }
        else if (++tries > 15) { clearInterval(t); finish(""); }
      }, 100);
    });
  }
  function readPost(rootEl) {
    const box = rootEl.querySelector('[data-testid="expandable-text-box"]');
    if (!box) return null;
    const before = [...rootEl.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')]
      .filter((a) => a.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING && !box.contains(a));
    const lastHref = before.at(-1)?.href;
    const authorLinks = before.filter((a) => a.href === lastHref);
    const lines = authorLinks.map((a) => a.innerText).join("\n").split("\n").map(clean).filter((l) => l && !/^(•|·|\d+(st|nd|rd|th)\+?|Follow|Verified|Premium)$/i.test(l));
    const url = lastHref ? lastHref.split("?")[0] : "";
    const name = lines[0] || "";
    const text = clean(box.innerText).replace(/…\s*more$/i, "").trim();
    // Headline: the first real line of text between the author link and the post.
    let headline = lines.find((l, i) => i > 0 && l !== name && l.length > 12) || "";
    const last = before.at(-1);
    if (!headline && last) {
      const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
      w.currentNode = last;
      let n;
      while ((n = w.nextNode()) && !box.contains(n)) {
        const t = clean(n.textContent);
        if (t.length > 12 && t !== name && !/^\d+\s*(s|m|h|d|w|mo|yr)\b|^(Promoted|Edited|Follow|Visit my website)/i.test(t)) { headline = t; break; }
      }
    }
    return { box, author: { name, headline: headline.slice(0, 160), url }, text };
  }

  function decoratePosts() {
    if (!location.pathname.startsWith("/feed") && !location.pathname.includes("/recent-activity") && !location.pathname.startsWith("/posts")) return;
    document.querySelectorAll("main [aria-label*='Repost']:not([data-ac-post])").forEach((rp) => {
      rp.setAttribute("data-ac-post", "1");
      let el = rp;
      while (el.parentElement && el.parentElement.querySelectorAll("[aria-label*='Repost']").length === 1 && el.parentElement.tagName !== "MAIN") el = el.parentElement;
      const post = readPost(el);
      if (!post || !post.text || el.querySelector("[data-ac-postbar]")) return;
      const bar = document.createElement("div");
      bar.setAttribute("data-ac-postbar", "1");
      bar.style.cssText = "margin:2px 0 0;";
      post.box.parentElement.after(bar);
      const sr = bar.attachShadow({ mode: "open" });
      bar._paint = () => {
        const p = readPost(el) || post;
        // The opening of the text, so the id is the same before and after "… more".
        const id = hash((p.author.url || p.author.name) + "|" + p.text.slice(0, 100));
        const on = savedPosts.has(id);
        const topics = topicsOf(p.text);
        const did = commentedPosts.has(id);
        const relTip = `Relevant: mentions ${topics.join(", ")}. A good comment here puts you in front of the people you want.`;
        sr.innerHTML = `<style>
          :host { display:block; }
          .r { display:flex; gap:4px; align-items:center; }
          .i { width:26px; height:26px; display:inline-grid; place-items:center; border-radius:50%; font-size:14px; line-height:1; }
          button.i { border:none; background:transparent; color:${on ? "#4f46e5" : "#8e8e93"}; cursor:pointer; font-size:16px; padding:0; }
          button.i:hover { background:#f2f2f7; color:#4f46e5; }
          .rel { background:#e3f9e9; } .did { background:#eef0ff; }
        </style><div class="r"><button class="i" title="${on ? "Bookmarked on Agentic Contacts. Click to remove." : "Bookmark on Agentic Contacts"}">${BOOKMARK(on)}</button>${did ? `<span class="i did" title="You commented here. See how many people saw it in the dashboard → Visibility.">💬</span>` : topics.length ? `<span class="i rel" title="${esc(relTip)}">💬</span>` : ""}</div>`;
        sr.querySelector("button").onclick = async (e) => {
          e.preventDefault(); e.stopPropagation();
          if (on) { await send("unsavePost", { id }); return; }
          await bookmarkPost(el, p);
        };
      };
      bar._paint();
    });
  }
  // Save a post: whole text ("… more" opened), and its own link.
  async function bookmarkPost(el, p) {
    const id = hash((p.author.url || p.author.name) + "|" + p.text.slice(0, 100));
    el.querySelector('[data-testid="expandable-text-button"]')?.click();
    await sleep(250);
    const full = readPost(el) || p;
    await send("savePost", { post: { id, author: full.author, text: full.text, pageUrl: location.href } });
    const url = await postLinkOf(el);
    if (url) await send("setPostUrl", { id, url });
  }
  // LinkedIn's own ••• → Save also bookmarks the post here.
  let menuPost = null;
  document.addEventListener("click", (e) => {
    const mb = e.target.closest?.("button[aria-label^='Open control menu for post']");
    if (mb) { menuPost = postRootOf(mb); return; }
    const mi = e.target.closest?.('[role="menuitem"]');
    if (mi && menuPost && clean(mi.innerText) === "Save" && document.documentElement.dataset.acGrabLink !== "1") {
      const root = menuPost, p = readPost(root);
      if (p?.text) setTimeout(() => bookmarkPost(root, p), 600);
    }
  }, true);
  function repaintPostBars() { document.querySelectorAll("[data-ac-postbar]").forEach((b) => b._paint?.()); }

  // ── Comments: what's relevant, what you said, how visible it was ──
  const TOPIC_RES = (self.TOPICS || []).map((t) => ({ label: t.label, re: new RegExp(t.re, "i") }));
  const topicsOf = (text) => TOPIC_RES.filter((t) => t.re.test(text || "")).map((t) => t.label);
  let commentedPosts = new Set();
  chrome.storage.local.get("comments").then(({ comments = [] }) => { commentedPosts = new Set(comments.map((c) => c.postId)); repaintPostBars(); }).catch(() => {});
  chrome.storage.onChanged.addListener((ch) => { if (ch.comments) { commentedPosts = new Set((ch.comments.newValue || []).map((c) => c.postId)); repaintPostBars(); } });
  const postRootOf = (node) => {
    let el = node;
    while (el && el.tagName !== "MAIN" && !(el.querySelector?.("[aria-label*='Repost']") && el.querySelector?.('[data-testid="expandable-text-box"]'))) el = el.parentElement;
    return el && el.tagName !== "MAIN" ? el : null;
  };
  const postIdOf = (p) => hash((p.author.url || p.author.name) + "|" + p.text.slice(0, 100));
  const EDITOR = '[aria-label^="Text editor for creating"], [contenteditable="true"][role="textbox"]';
  function captureComment(fromEl) {
    let wrap = fromEl, ed = null;
    for (let i = 0; i < 10 && wrap && !ed; i++, wrap = wrap.parentElement) ed = wrap.querySelector?.(EDITOR);
    const comment = clean(ed?.innerText || "");
    if (!ed || !comment) return;
    const root = postRootOf(ed);
    const p = root && readPost(root);
    if (!p || !p.text) return;
    send("logComment", { post: { id: postIdOf(p), author: p.author, text: p.text }, comment, pageUrl: location.href });
  }
  // The click on LinkedIn's "Comment" / "Reply" button, before the box clears.
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("button");
    if (!b || host.contains(b) || !/^(Comment|Reply|Post)$/i.test(clean(b.innerText))) return;
    let w = b, near = false;
    for (let i = 0; i < 6 && w; i++, w = w.parentElement) if (w.querySelector?.(EDITOR)) { near = true; break; }
    if (near) captureComment(b);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target.closest?.(EDITOR)) captureComment(e.target);
  }, true);

  // On your Comments activity page: read reactions and impressions of each comment.
  const relAge = (t) => {
    const m = String(t).match(/^(\d+)\s*(s|m|h|d|w|mo|yr)$/);
    if (!m) return new Date().toISOString();
    const n = +m[1], ms = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5, mo: 2592e6, yr: 31536e6 }[m[2]];
    return new Date(Date.now() - n * ms).toISOString();
  };
  let syncTimer = null, lastSync = "";
  function readMyComments() {
    if (!/^\/in\/[^/]+\/recent-activity\/comments/.test(location.pathname)) return;
    if (syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      const items = [];
      document.querySelectorAll("main [aria-label*='Repost']").forEach((rp) => {
        let el = rp;
        while (el.parentElement && el.parentElement.querySelectorAll("[aria-label*='Repost']").length === 1 && el.parentElement.tagName !== "MAIN") el = el.parentElement;
        const p = readPost(el);
        if (!p || !p.text) return;
        el.querySelectorAll("button[aria-label^='View more options for']").forEach((opt) => {
          let c = opt;
          for (let i = 0; i < 12 && c && !/impressions?/i.test(c.innerText || ""); i++) c = c.parentElement;
          // Only your own comment, and only this one (not a box holding several).
          if (!c || c.querySelectorAll("button[aria-label^='View more options for']").length !== 1 || !/\bYou\b/.test(c.innerText)) return;
          const lines = c.innerText.split("\n").map(clean).filter(Boolean);
          const ti = lines.findIndex((l) => /^\d+\s*(s|m|h|d|w|mo|yr)$/.test(l));
          const body = [];
          for (const l of lines.slice(ti + 1)) { if (/^(Show translation|Like|Reply|Edited)$/i.test(l) || /^\d[\d,]*$/.test(l) || /impressions?$/i.test(l)) break; body.push(l); }
          const comment = body.join("\n");
          if (!comment) return;
          const num = (re) => { const m = c.innerText.match(re); return m ? Number(m[1].replace(/,/g, "")) : 0; };
          const reactBtn = [...c.querySelectorAll('[role="button"]')].find((x) => /^\d[\d,]*(\n\d[\d,]*)?$/.test((x.innerText || "").trim()));
          items.push({
            postId: postIdOf(p), author: p.author, postText: p.text, comment,
            at: relAge(lines[ti]), impressions: num(/([\d,]+)\s+impressions?/i),
            reactions: reactBtn ? Number(reactBtn.innerText.trim().split("\n")[0].replace(/,/g, "")) : 0,
            replies: num(/([\d,]+)\s+repl(y|ies)/i),
          });
        });
      });
      const sig = JSON.stringify(items.map((x) => [x.postId, x.reactions, x.impressions, x.replies]));
      if (items.length && sig !== lastSync) { lastSync = sig; send("syncComments", { items }); }
    }, 1500);
  }

  // On your LinkedIn dashboard: save today's profile numbers.
  let visTimer = null, visDone = "";
  function readVisibility() {
    if (!location.pathname.startsWith("/dashboard")) return;
    if (visTimer || visDone === location.pathname) return;
    visTimer = setTimeout(() => {
      visTimer = null;
      const t = (document.querySelector("main") || document.body).innerText.replace(/\n+/g, " | ");
      const grab = (label) => { const m = t.match(new RegExp("([\\d,]+) \\| " + label)); return m ? Number(m[1].replace(/,/g, "")) : undefined; };
      const v = { postImpressions7d: grab("Post impressions"), followers: grab("Total followers"), profileViewers90d: grab("Profile viewers"), searchAppearances: grab("Search appearances") };
      if (Object.values(v).some((x) => x !== undefined)) { visDone = location.pathname; send("visibilitySnapshot", { v }); }
    }, 1500);
  }

  // ── Time on LinkedIn ────────────────────────────────────────────────
  // Every 15 s, if this tab is in front and you touched it in the last
  // minute, add 15 s to today's bucket for this kind of page.
  let lastInput = Date.now();
  ["mousemove", "keydown", "scroll", "click"].forEach((ev) => addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true }));
  const pageKind = () => {
    const p = location.pathname;
    return p.startsWith("/feed") ? "feed" : /^\/(in|pub)\//.test(p) ? "profiles" : p.startsWith("/search") ? "search"
      : p.startsWith("/messaging") ? "messages" : p.startsWith("/mynetwork") ? "network" : p.startsWith("/jobs") ? "jobs"
      : p.startsWith("/notifications") ? "notifications" : "other";
  };
  setInterval(async () => {
    if (document.visibilityState !== "visible" || !document.hasFocus() || Date.now() - lastInput > 60000) return;
    try {
      const d = new Date();
      const key = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const { time = {} } = await chrome.storage.local.get("time");
      const t = (time[key] ||= {});
      t[pageKind()] = (t[pageKind()] || 0) + 15;
      // Keep a year.
      for (const k of Object.keys(time)) if (k < new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10)) delete time[k];
      await chrome.storage.local.set({ time });
    } catch { /* extension reloaded */ }
  }, 15000);

  let pending = null;
  let sentCount = 0;
  new MutationObserver(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      markKnown();
      decorateCards();
      decoratePosts(); readMyComments(); readVisibility(); watchPending();
      onRoute();
      scanAcceptances();
      if (!target) paintTab();
      // New rows loaded on Sent invitations: redraw the list (unless typing).
      if (open && onSentPage()) {
        const n = readSentInvites().length;
        if (n !== sentCount && !root.activeElement) { sentCount = n; renderSent(); }
      }
    }, 600);
  }).observe(document.body, { childList: true, subtree: true });

  loadIndex().then((r) => {
    onRoute();
    if (r.ok) setTimeout(scanAcceptances, 1500);
    if (!r.ok) $("tabText").textContent = "Contacts: set up";
    // Open by itself on Sent invitations when some reasons are missing.
    if (r.ok && onSentPage()) setTimeout(() => { if (readSentInvites().some((x) => !index[x.slug]?.reasonSaved)) { view = "here"; setOpen(true); } }, 1500);
  });
})();
