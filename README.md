# 🏸 Club Bot

**A WhatsApp bot that runs your weekly sports session for you.**
It finds courts, runs the vote, posts the booking link, collects the money, reminds everyone personally,
and when someone drops out it fills their spot from the waitlist automatically.

Badminton and tennis built in. Adding a sport is one file. MIT licensed.

> Built at the Grok Bot Community Engineering London Hackathon (22 Oct 2026), Wildcard track.

---

## Why

Every casual club organiser runs the same loop by hand, every week:

1. Check three venue websites for free courts.
2. Post a poll in the group, chase people to vote.
3. Book the court, then chase everyone for their share.
4. Remind people on the day.
5. Someone drops out an hour before. Scramble to find a replacement.

Club Bot does all five inside the WhatsApp group the club already uses. Nobody installs anything.

## What it looks like

```
You      !play badminton sat
Bot      📊 Badminton Sat 24 Oct: pick every time you can play
           ☐ 10am–12pm · from £12.00pp
           ☐ 12–2pm · from £11.00pp
           ☐ 6–8pm · from £12.00pp …
Bot      📊 📍 Where? Tick every venue you're happy with
           ☐ Better · Islington Tennis Centre
           ☐ Everyone Active · Seymour Leisure Centre

         … everyone votes (or 48 hours pass) …

Bot      12–2pm wins (3 free). Booking now.
         Playing (2/2): @Asha, @Ben   Waitlist: @Chen
Bot      📅 Book Badminton · Everyone Active · Sat 24 Oct, 12:00 here: <link>
         @Asha tap ✅ below once it's booked.          [✅ Booked it]
Bot      ✅ Court booked!  💷 £22.00 ÷ 2 = £11.00 each. Payment links sent privately.

  (DM)   💷 Your share: £11.00 · Pay here: <link>       [✅ I've paid]
  (DM)   ⏰ Starting in 2 hours · 📍 <maps link>         [✅ I'm coming] [❌ Can't make it]

Ben taps ❌ Can't make it
Bot      @Ben dropped out. Offering the spot to the waitlist…
  (DM to Chen)  A spot opened up! Want it?               [✅ Take the spot] [❌ Pass]
Chen taps ✅
Bot      🎉 @Chen takes the spot.  Playing (2/2): @Asha, @Chen
```

A live dashboard at `http://localhost:3000` shows the same thing: countdown, vote bars, roster, who has paid.

## Features

| | |
|---|---|
| **Court search** | Searches every venue for the sport and builds playable windows (e.g. 2 hours of back-to-back slots at one venue). |
| **Two polls** | Multi-choice poll for times, plus a poll for venues. Most-voted time wins, then the most-voted venue that has it free (cheapest if nobody picked). |
| **Auto-close** | Polls close after 48 hours, or as soon as every group member has voted. |
| **Weekly autopilot** | `!weekly badminton sat` posts the poll every Monday 10:00 (London) with no one lifting a finger. |
| **Booking** | Booking link posted in the group and to the organiser; one tap on ✅ Booked it confirms. |
| **Payments** | After booking, each player gets their share and a payment link by DM, plus a ✅ I've paid button. |
| **Personal reminders** | DM 2 hours and 30 minutes before, with the map link and a tap-to-drop-out button. |
| **Waitlist auto-fill** | Drop out by tapping, typing `OUT`, or unticking your time in the poll. The next person (reliable players first) gets the spot offered; unanswered offers expire and move on. |
| **Live dashboard** | Supabase Realtime pushes every vote, drop-out and payment to the page instantly. |
| **Club memory** | Every game, vote and drop-out goes into Cognee. Ask `!ask who drops out most?` |
| **Session log** | Finished games are logged to a Notion database. |

## Quick start

You need Node 20+, a Supabase project (free tier is fine) and a **spare WhatsApp number**.

```bash
git clone https://github.com/gnani4444/club-bot.git
cd club-bot
npm install
cp .env.example .env
```

1. In Supabase, open the SQL editor and run [`supabase/schema.sql`](supabase/schema.sql).
2. Put `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (Project Settings → API) in `.env`.
3. Put your group's invite link in `WHATSAPP_INVITE` and your Monzo/Revolut link in `PAY_LINK`.
4. Start it:
   ```bash
   npm start
   ```
5. On the spare phone: WhatsApp → Settings → Linked devices → Link a device, and scan the QR in the terminal.
   The bot joins your group by itself.
6. Send `!help` in the group.

> ⚠️ Club Bot uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial WhatsApp client.
> WhatsApp can ban numbers that behave like bots. Always use a spare number, never your personal one.
> The login is saved in `.auth/`; delete that folder to log out.

## Commands

**In the group**

| Command | What it does |
|---|---|
| `!play <sport> [day] [players]` | Search courts and post the time + venue polls. Day: `today`, `tomorrow`, `mon`…`sun` or `2026-10-24`. Players defaults to 2. |
| `1 3` | Vote by number instead of tapping (several allowed). |
| `!close` | Close the vote now instead of waiting. |
| `!weekly <sport> <day> [players]` | Auto-post the poll every Monday 10:00. `!weekly` shows it, `!weekly off` stops it. |
| `!booked` | Same as tapping ✅ Booked it. |
| `!pay` | Re-send payment requests to anyone unpaid. |
| `!paid @name` | Mark someone as paid by hand. |
| `!remind` | Send reminders now (they also go automatically at 2h and 30m). |
| `!status` | Show the roster. |
| `!done` | Close the session; logs it to Notion and club memory. |
| `!ask <question>` | Ask club memory (Cognee). |
| `!help` | List commands. |

**In a private chat with the bot**: `OUT` to drop out, `IN` to take an offered spot. Every DM also has tap buttons.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | yes | Database. The service key never leaves the server. |
| `WHATSAPP_INVITE` | no | Group invite link; the bot joins it on connect. Or add the number to the group by hand. |
| `PAY_LINK` | no | Payment link sent with each share (Monzo, Revolut, PayPal.me…). |
| `STRIPE_SECRET_KEY` | no | Stripe **test** key. Creates a payment link per session instead of `PAY_LINK`. |
| `COGNEE_API_URL`, `COGNEE_API_KEY` | no | Club memory for `!ask`. |
| `NOTION_TOKEN`, `NOTION_DB_ID` | no | Session log. The database's title property must be called `Name`. |
| `OFFER_TIMEOUT_SEC` | no | How long a waitlist offer stays open (default 900; 60 is good for demos). |
| `PORT` | no | Dashboard port (default 3000). |

Every optional integration switches itself off when its variables are empty.

**Upgrading an existing database?** Run the files in [`supabase/migrations/`](supabase/migrations) in order. A fresh install only needs `schema.sql`.

## Add a sport

Create `src/sports/padel.ts`:

```ts
import type { Sport } from "./types.js";
import { fixtureVenue } from "../venues/fixture.js";

export const padel: Sport = {
  id: "padel",
  name: "Padel",
  playersPerCourt: 4,
  sessionHours: 1,
  venues: [
    fixtureVenue({
      id: "my-venue", name: "My Padel Club", sport: "padel",
      hours: [18, 19, 20], minutes: 60, pricePence: 3200,
      bookingUrl: "https://example.com/book", address: "1 Court Lane, London",
    }),
  ],
};
```

Add it to the list in [`src/sports/index.ts`](src/sports/index.ts). Done: `!play padel sat` works.

A venue is anything with `search(date) => Promise<Slot[]>`, so a live scraper drops in where `fixtureVenue` is.

## How it works

```
 WhatsApp group + DMs
        │  (Baileys, linked device)
        ▼
   src/wa.ts ──────── polls, taps, @lid ↔ phone mapping, 1 msg/sec send queue
        │
   src/club.ts ────── the club workflow: play → vote → close → book → pay → remind → waitlist
        │      │
        │      └──── src/search.ts + src/sports/* + src/venues/*   (court search, time windows)
        │
   Supabase ───────── players · sessions · slots · votes · rsvps · schedules
        │
        ├── src/dashboard.ts + web/index.html   (Realtime → server-sent events → live page)
        └── src/sponsors.ts                     (Stripe, Cognee, Notion; each optional)
```

A 15-second tick handles everything time-based: weekly polls, auto-close, reminders and expired waitlist offers.
Pure rules (who wins, roster order, cost split, reminder timing) live in [`src/logic.ts`](src/logic.ts) and are unit tested.

## Development

```bash
npm test             # unit tests: voting, roster, waitlist, cost split, reminders, search, time windows
npm run e2e          # whole club flow against your Supabase with a fake WhatsApp; cleans up after itself
npm run typecheck
npm run search -- tennis sat     # print merged court availability
```

`npx tsx scripts/say.ts "<group jid>" "<text>"` posts a one-off message as the bot (stop `npm start` first).

## Known limitations

- **Availability is not live yet.** Venue sites (Better, Everyone Active, Clubspark) have no public API and refuse direct calls,
  so each venue currently returns its usual timetable with real booking links. Live adapters are the next step.
- Poll taps are matched to polls kept in memory: after a restart, taps on older polls are ignored (typed `IN`/`OUT`/numbers still work).
- Payments are links, not money movement. The organiser can always mark people with `!paid @name`.

## Built with

[Supabase](https://supabase.com) (database + Realtime) · [Cognee](https://cognee.ai) (club memory) · [Notion](https://developers.notion.com) (session log) ·
[Baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp) · built with [Cursor](https://cursor.com) and Grok Bot.

## License

[MIT](LICENSE)
