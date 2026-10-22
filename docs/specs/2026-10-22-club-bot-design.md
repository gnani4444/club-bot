# Club Bot — Design Spec

Date: 2026-10-22 · Event: Grok Bot Community Engineering London Hackathon · Code freeze 21:50

## Problem

Organisers of casual sports clubs (badminton, tennis, padel, ...) run the same loop every week by hand:
check several venue sites for free courts, ask the WhatsApp group which slot works, book it, chase people
for money, remind them, and scramble to fill spots when someone drops out.

## Users

- **Organiser** — runs the club, books courts, fronts the money.
- **Player** — member of the WhatsApp group. Votes, pays, turns up.

## Track

Primary: **Wildcard · Weird Stuff**. Overlaps Track 3 (Event Autopilot: comms, reminders) and
Track 5 (Front Desk & Revenue: fees, inbound chat). Pitch: "recurring-event ops for any club",
sports first.

## Goals (demo scope)

1. **Court search** — 2–3 venue adapters per sport, merged into one slot list.
2. **Group poll** — bot posts a WhatsApp poll of top slots, tallies votes, announces winner.
3. **Booking** — bot DMs organiser a one-tap booking deep link. Playwright auto-book on one venue only if stable.
4. **Fees** — split court cost across confirmed players, DM each a payment link, track paid status.
5. **Reminders + waitlist** — personal DM at T-2h and T-30m with maps link and "reply OUT if you can't make it".
   OUT moves player out and offers the spot to the next waitlisted player.

**Killer demo:** player replies OUT live; bot instantly DMs waitlist #1, they reply IN, group gets updated roster.

## Non-goals

- Fully automatic booking the second a slot opens (ToS + bot detection + stored cards).
- Holding real money. Payments are links only (Stripe test mode).
- Official WhatsApp Business API (cannot join normal groups).

## Architecture

```
WhatsApp group/DMs  <->  Baileys bot (Node/TS)  <->  Supabase (Postgres + Realtime)
                              |                          ^
                              |-- sports/<sport>.ts      |-- organiser dashboard (Realtime)
                              |     venue adapters       |
                              |-- scheduler (node-cron)  |-- Notion (session log, roster)
                              |-- Stripe payment links   |-- Cognee (player memory)
```

- **Runtime:** Node 20 + TypeScript, single process.
- **WhatsApp:** Baileys (unofficial, multi-device). Burner number: ban risk accepted for demo.
- **Scheduler:** node-cron, checks every minute for sessions hitting T-2h / T-30m.

### Sport plugin interface (extensibility)

New sport = one new file in `src/sports/`. Nothing else changes.

```ts
export interface Slot {
  sport: string; venueId: string; venueName: string;
  start: string; end: string;           // ISO 8601, Europe/London
  courtPricePence: number; bookingUrl: string; mapsUrl: string;
}

export interface VenueAdapter {
  id: string; name: string;
  search(date: string): Promise<Slot[]>;
}

export interface Sport {
  id: string;                           // "badminton", "tennis"
  name: string;
  playersPerCourt: number;              // badminton 4 (doubles), tennis 4
  venues: VenueAdapter[];
}
```

First adapters: Better (badminton), Everyone Active (badminton), Clubspark/LTA (tennis).
Each adapter has a fixture fallback so demo works if a site blocks scraping.

### Data model (Supabase)

| Table | Key columns |
|-------|-------------|
| `players` | id, phone, name |
| `sessions` | id, sport, venue_id, start, end, court_price_pence, capacity, status (`polling`/`booked`/`done`), group_jid |
| `slots` | id, session_id, payload jsonb, votes int |
| `rsvps` | session_id, player_id, status (`in`/`out`/`waitlist`), position, reminded_2h, reminded_30m |
| `payments` | session_id, player_id, amount_pence, link_url, paid bool |

## WhatsApp flows

| Trigger | Bot action |
|---------|-----------|
| `!play badminton sat` in group | search all badminton adapters, post poll of top 5 slots |
| poll closes (timer or `!close`) | pick winner, create session, DM organiser booking link |
| organiser replies `booked` | post roster: first N voters `in`, rest `waitlist` |
| `!pay` (organiser) | split cost, DM each `in` player payment link |
| scheduler T-2h / T-30m | personal DM: time, venue, maps link, "reply OUT if you can't make it" |
| player DMs `OUT` | set `out`, promote waitlist #1, DM them "spot open, reply IN" |
| waitlist player DMs `IN` | set `in`, post updated roster to group |

## Sponsor integrations

| Sponsor | Use | Priority |
|---------|-----|----------|
| **Supabase** | All state; Realtime powers organiser dashboard showing live roster and paid status | Must |
| **Cognee** | Player memory: preferred days/times, venues, skill level, no-show history. Ranks poll slots and orders waitlist (reliable players first) | Should |
| **Notion** | After each session, write log page (who played, cost, paid) and per-sport roster DB via API | Should |
| **Zero** | Luma sync for open sessions; find local sponsors (sports shops, racket brands) for the club | Stretch |
| **Grok Bot** | Research venue sites and plan the build via its skill | Build tool |
| **Cursor** | Editor/agent used to build | Build tool |

## Judging fit

- *Open source, runnable next week:* MIT, `.env.example`, one `npm start`, fixtures for venues.
- *Community context:* real club loop; Cognee memory of players.
- *Better than today:* replaces manual WhatsApp polls + spreadsheet + chasing.
- *Demo quality:* live drop-out to waitlist fill on two phones.

## Risks

- Venue sites block scraping: fixture fallback per adapter.
- Baileys session drops: keep QR auth state on disk; pre-pair before demo.
- WhatsApp poll vote decryption in Baileys is fiddly: fallback to numbered reply (`1`–`5`).
