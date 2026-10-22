# Club Bot

A WhatsApp bot that runs your weekly sports session: finds courts, runs the vote, sends the booking link,
splits the cost, reminds people personally, and fills drop-outs from the waitlist automatically.
Badminton and tennis built in; adding a sport is one file.

Built at the Grok Bot Community Engineering London Hackathon (22 Oct 2026), Wildcard track. MIT licensed.

## How it works

| In the group | Bot does |
|---|---|
| `!play badminton sat` | searches every badminton venue, posts a poll of the top 5 slots (or reply `1`–`5`) |
| `!close` | picks the winning slot, posts roster + waitlist, DMs you the one-tap booking link |
| `!booked` | confirms the booking, turns on reminders |
| `!pay` | splits the court cost, DMs each player their share and a payment link |
| `!paid @name` | marks someone as paid |
| `!remind` | sends reminders now (otherwise automatic at 2h and 30m before) |
| `!status` / `!done` / `!ask <question>` | roster / close session (logs to Notion) / ask club memory (Cognee) |

| In a DM | Bot does |
|---|---|
| `OUT` | drops you, then offers your spot to the next person on the waitlist |
| `IN` | takes an offered spot; group gets the updated roster |

Waitlist order puts people who rarely drop out first. Unanswered offers expire after `OFFER_TIMEOUT_SEC`.

## Run it

1. Create a Supabase project and run `supabase/schema.sql` in the SQL editor.
2. `cp .env.example .env` and fill `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
3. `npm install && npm start`
4. Scan the QR with WhatsApp on a **spare number** (Linked devices). Set `WHATSAPP_INVITE` to your group link and the bot joins it, or add the number to the group by hand.
5. Dashboard: http://localhost:3000

> Baileys is an unofficial WhatsApp client. WhatsApp can ban numbers that behave like bots: use a spare number.

Optional: `STRIPE_SECRET_KEY` (test mode) for per-session payment links, `NOTION_TOKEN` + `NOTION_DB_ID`
for session logs (database title property must be `Name`), `COGNEE_API_URL` + `COGNEE_API_KEY` for club memory.

## Add a sport

Create `src/sports/padel.ts`:

```ts
import type { Sport } from "./types.js";
import { fixtureVenue } from "../venues/fixture.js";

export const padel: Sport = {
  id: "padel", name: "Padel", playersPerCourt: 4, sessionHours: 2,
  venues: [fixtureVenue({ id: "my-venue", name: "My Venue", sport: "padel", hours: [18, 19], minutes: 60,
    pricePence: 3200, bookingUrl: "https://...", address: "..." })],
};
```

Then add it to the list in `src/sports/index.ts`. A venue is any object with `search(date) => Slot[]`,
so swap `fixtureVenue` for a live scraper when a venue exposes availability.

## Sponsors used

- **Supabase**: all state, plus Realtime powering the live dashboard.
- **Cognee**: club memory (who plays when, who drops out); `!ask` queries it.
- **Notion**: session log page per game.
- **Cursor / Grok Bot**: built with.

## Develop

`npm test` (rules: voting, roster, waitlist, cost split, reminders, search) · `npm run typecheck` · `npm run search -- tennis sat`
