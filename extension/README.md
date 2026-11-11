# Agentic Contacts for LinkedIn (Chrome extension) · v0.13

## How to work with it: three steps, in this order

1. **Pick people.** Claude finds people who match who you're looking for. You keep or skip each one, one at a time. You can also save posts from your feed; Claude says if the author is a match, and you add them.
2. **Reach out.** Everyone you kept. Open their LinkedIn and press Connect: the panel asks why, can write the note, and records it. They wait here until they accept.
3. **Follow up.** People who accepted, wrote back, or are due a nudge. Send a message; the extension records it. When someone agrees to talk, set their stage to *call*.

**When you press Connect,** LinkedIn's request is held until the panel is filled in: why, **who they are** (one of your ICPs), **what you're offering them** (your offers, most recently used first, or + New offer) and **what to say when they accept**. The panel's **Connect on LinkedIn** saves it all and sends the request; "Connect without saving" just sends it. When the extension sees they accepted (your Notifications page, your Connections page, or their profile showing 1st), you get a Chrome notification and the panel opens with your message, why you reached out and the ICP. Copy it, or on their profile press "Write it in a message" (it fills LinkedIn's message box; you press Send).

**Every day, alongside the steps: comment on relevant posts.** In the feed, posts about your topics (sandboxes, agents, evals, AI cost, agent infra; set in `icps.js` → `TOPICS`) are marked **💬 Relevant · worth a comment**. When you press Comment, the extension records the post, the author and what you wrote; if the author is in your contacts, it goes into their history. Posts you've commented on show **💬 You commented**.

**Visibility** (dashboard tab) shows every comment with how many people saw it and reacted, comments per week, and your profile viewers, search appearances and followers over time. Comment numbers are read when you open your LinkedIn Comments page (this also brings in comments you left before installing); profile numbers when you open your LinkedIn dashboard.

**Offers** (dashboard tab) lists what you sell: name, one-line pitch, who it's for, how often you've used it and how many people you pitched it to. Add, edit or delete there; the same list shows in the panel when you press Connect, and the CLI (`offers`, `offer-add`, `offer-edit`, `offer-rm`) edits it too. Offers are stored in the Contacts API (`/offers`).

**Results** shows how far everyone got (asked → accepted → replied → call), by who they are and by campaign. Campaigns are optional labels; you don't need them to work.

The dashboard (toolbar icon or panel → Open the full page) has a tab per step plus Today and Results. The panel on LinkedIn has three tabs: **Here** (this page or person), **Today** (the three steps, with today's goals and who is due), **Posts**.

## Everything it does

- **On a profile:** a panel says whether the person is in your contacts, why you wanted to connect, their stage, follow-up, notes and history. Not in yet: add them in one click (name, title and company are read from the page).
- **When you press Connect** (anywhere), the panel opens on that person and asks why and for which campaign. LinkedIn's Send is recorded too, with the note you typed.
- **Campaign and tag boxes** suggest what you already use as soon as you click them (most-used first); type to filter, ↑/↓ and Enter to pick.
- **List pages** (Grow, search, invitations): a bar under each person with their tags and why, or a quick Save.
- **Campaigns** (panel on any non-profile page): per campaign how many people, asked, accepted, replied and call+. Open one to see everyone, write what the campaign is about (used for drafts), or make a list of them in the Contacts app.
- **Today** (dashboard's first tab): daily goals (reach out to X new people, follow up with Y, review Z suggestions; editable), "Do this next" with the person to open, a streak of days both goals were met, a 12-month GitHub-style grid of your days (from the Contacts history), and time on LinkedIn by kind of page (tracked from install on, only while a LinkedIn tab is in front and in use; stored in this browser only).
- **ICPs** (`icps.js`): who you're looking for, each written as one person. Suggested people carry `icp:<id>` and are reviewed one at a time per ICP.
- **Saved posts:** in the feed (and on activity and post pages), each post gets a **☆ Save post** bar. Saved posts show in the dashboard's **Posts** tab. "Review with Claude" says which ICP the author fits (score 0–10), why, a comment you could leave and a first message, each with a Copy button. "Add author to Contacts" saves the author with the ICP tag, `from-post` and the post in the notes. "Copy all for Claude Code" copies every post as text. Posts are kept in this browser (up to 500).
- The panel remembers whether you left it open or folded.
- **Dashboard** (panel → Campaigns → Dashboard ↗): a funnel (saved → asked → accepted → replied → call+ → won) for everyone or one campaign/list, every campaign and app list side by side with conversion rates, and the people at each step. Stages count too: `stage:contacted` = asked.
- **Acceptances:** opening Notifications or your Connections list records who accepted your requests.
- **Messaging:** in a chat, the panel shows the person (matched by name), the last message, "Log last message", and marks them `linkedin:replied` once they have written.
- **Stage:** one click (lead → won/lost) on any known person.
- **Drafting (optional):** with an Anthropic API key in settings, "Draft with Claude" writes a connection note (≤300 chars), a first message or a reply from the profile, your reason, the campaign and your "About you". Insert puts it into LinkedIn's note or message box; you still press Send.

## Install

1. Chrome → `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → pick this `extension/` folder.
3. Settings (toolbar icon off LinkedIn): leave the key empty if you're signed in to the Contacts app in this browser, or paste `CONTACTS_API_KEY`. For drafting, add an Anthropic API key and a line about you.

Keys stay in Chrome's extension storage. The contacts key is only sent to the contacts API, the Anthropic key only to api.anthropic.com. The content script never sees either; all calls go through `background.js`.

## Notes

- Tags it writes: `linkedin:requested`, `linkedin:connected`, `linkedin:replied`, `linkedin:inbound`, `campaign:<name>`, `stage:<stage>`. Reasons go into notes as `Why connect (date · campaign): …`. Campaign pitches are kept in extension storage, not on the server.
- Offers use `/offers` on the Contacts API (table `offers`, migration `0004`). Everything else uses the existing endpoints.
- LinkedIn changes its markup often. Profile reading is in `readProfile()`, chats in `readThread()` / `readMessages()`, list cards in `cardsOnPage()`.
