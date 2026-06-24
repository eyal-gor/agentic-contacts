# B2B Sales Playbook (founder-led)

This app doubles as the CRM for founder-led sales. The motion is manual on
purpose — you run the first ~20 deals by hand, learn the script, then systematize.

## Pipeline stages

Stored on a contact as a `stage:<name>` tag. Move people with
`contacts update <id> --stage <name>`.

| Stage       | Meaning                                            | Exit when…                          |
|-------------|----------------------------------------------------|-------------------------------------|
| `lead`      | Identified, fits ICP, not yet contacted            | First outreach sent                 |
| `contacted` | Outreach sent, awaiting / following up             | They agree to talk                  |
| `call`      | Discovery call booked or held                      | They start a trial/pilot            |
| `trial`     | Actively trying the product                        | Pricing/proposal goes out           |
| `proposal`  | Proposal or price on the table                     | Signed, or walked                   |
| `won`       | Closed-won (paying)                                | —                                   |
| `lost`      | Closed-lost (track why in notes)                   | —                                   |

Non-sales relationships are kept OUT of the pipeline via these tags, so the
funnel stays honest: `advice` (advisors/mentors), `recruiting`, `do-not-contact`.
`contacts pipeline` hides them; `contacts pipeline --all` shows everyone.

## ICP segments

cerver has two ICPs — keep them in separate motions, separate scripts, separate copy.
Tag with `contacts update <id> --icp dev` / `--icp biz`.

- `icp:dev`  — developers (cerver `/`): the agent-to-agent delegation story.
- `icp:biz`  — business buyers (cerver `/build`): the outcome story.

## The motion (per the 8-step playbook)

1. **One narrow ICP at a time.** Not "devs" — a specific person with an acute pain.
2. **Build a list with triggers.** Each lead needs a *why now* (raised, posted, uses a competitor) in `--notes`.
3. **Personalized outreach.** First line tied to the trigger; one sentence of problem-in-their-words; a tiny ask. No links in the first message. Follow up 2–4x.
4. **Discovery, not pitch.** How do you do this today? What's it cost when it breaks? Who else decides? What'd have to be true to switch?
5. **Sell the outcome, demo the proof.** Lead with before→after, not features.
6. **Always set a next step + date.** `log <id> --next <date>` every time. No date = dead deal.
7. **Handle the two objections.** "No budget" = wrong person or weak pain. "Need to think" = you didn't surface the cost of the status quo.
8. **Track pipeline like code.** `contacts pipeline` daily; `contacts due` for follow-ups.

## Daily routine

```
contacts due --window overdue     # who you owe a follow-up
contacts pipeline --icp dev        # where the dev funnel stands
contacts pipeline --icp biz        # where the business funnel stands
```

Log every touch, set the next date, move the stage. That's the whole job.
