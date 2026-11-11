# Agentic Contacts for LinkedIn (Chrome extension) · v0.7

The panel on LinkedIn has five tabs, and remembers the last one you used:

- **Page / person name** — what's on this page, or the person you're looking at.
- **Due** — follow-ups due today or earlier (red number).
- **Posts** — posts you saved from the feed, with Claude's review and Copy buttons.
- **Today** — your goals for today, streak, and who to reach out to next.
- **Campaigns** — each campaign's funnel; click one for the dashboard.

Pressing Connect on someone always jumps back to the person tab.


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
- Everything uses the existing API. No server change.
- LinkedIn changes its markup often. Profile reading is in `readProfile()`, chats in `readThread()` / `readMessages()`, list cards in `cardsOnPage()`.
