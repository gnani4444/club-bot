# Club Bot — Implementation Plan

Spec: [`docs/specs/2026-10-22-club-bot-design.md`](../specs/2026-10-22-club-bot-design.md)
Timebox: 18:10 → 21:50 code freeze. Each task ends with a check and a commit. Cut stretch items first.

## T0 — Scaffold (15 min)
- `package.json` (Node 20, TS, `tsx`), deps: `@whiskeysockets/baileys`, `@supabase/supabase-js`, `node-cron`, `stripe`, `zod`.
- `.env.example`: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY` (test), `ORGANISER_PHONE`, `GROUP_JID`, `NOTION_TOKEN`, `NOTION_DB_ID`, `COGNEE_API_KEY`.
- `supabase/schema.sql` with tables from spec. Apply in Supabase SQL editor.
- Check: `npm run typecheck` passes.

## T1 — Sport plugins + court search (40 min)
- `src/sports/types.ts` — `Slot`, `VenueAdapter`, `Sport`.
- `src/sports/badminton.ts`, `src/sports/tennis.ts`, `src/sports/index.ts` (registry).
- `src/venues/better.ts`, `src/venues/everyone-active.ts`, `src/venues/clubspark.ts` — fetch/parse; on failure return `fixtures/<venue>.json`.
- `src/search.ts` — `searchSport(sportId, date)`: run adapters in parallel, merge, sort by start then price.
- Check: `npm test -- search` — registry finds both sports; merge sorts fixtures correctly.

## T2 — WhatsApp bot + poll (45 min)
- `src/wa.ts` — Baileys connect, persist auth in `.auth/`, message router.
- `src/commands/play.ts` — `!play <sport> <day>`: search, store slots, send poll (top 5).
- `src/commands/close.ts` — tally (poll votes, fallback numbered replies), create session, DM organiser booking link.
- Check: run against test group on two phones; poll appears and winner announced.

## T3 — Booking + roster (20 min)
- Organiser `booked` reply: mark session `booked`; first `capacity` voters `in`, rest `waitlist` with position.
- Post roster to group.
- Optional: `src/venues/better.book.ts` Playwright auto-book, only if T1 site proves stable.
- Check: roster message matches `rsvps` rows.

## T4 — Fees (25 min)
- `src/commands/pay.ts` — `amount = ceil(court_price / in_count)`; Stripe Payment Link per player (test mode); DM link; insert `payments`.
- `src/webhook.ts` (or poll Stripe) — mark `paid`.
- Check: unit test for split rounding; test-mode payment flips `paid`.

## T5 — Reminders + waitlist (35 min) — KILLER DEMO
- `src/scheduler.ts` — node-cron every minute; DM `in` players at T-2h and T-30m (set `reminded_*`).
- `src/commands/out.ts` — `OUT` DM: status `out`, promote waitlist #1, DM "spot open, reply IN".
- `src/commands/in.ts` — `IN`: status `in`, post updated roster to group; no reply in 15 min → next waitlist.
- Check: unit test for promotion order; live two-phone run.

## T6 — Sponsors (30 min)
- **Supabase Realtime dashboard:** `web/index.html` subscribing to `rsvps` + `payments` for live roster/paid view.
- **Cognee:** `src/memory.ts` — `remember(player, event)` on vote/OUT/no-show; `rankSlots` + waitlist order use recall. Graceful no-op if key missing.
- **Notion:** `src/notion.ts` — on session `done`, create log page in `NOTION_DB_ID`.
- **Zero (stretch):** Luma sync of open sessions.
- Check: each integration logs success in demo run; app still works with keys unset.

## T7 — Ship (20 min, by 21:45)
- README: what, setup (`cp .env.example .env`, `npm i`, `npm start`, scan QR), how to add a sport.
- Push public GitHub repo (MIT LICENSE present).
- Rehearse demo script: `!play badminton sat` → vote → booked → `!pay` → force reminder → OUT → waitlist IN.

## Cut order if late
Zero → Playwright auto-book → Notion → Cognee → dashboard. Never cut T5.
