import { test } from "node:test";
import assert from "node:assert/strict";
import { winner, buildRoster, nextOnWaitlist, share, dueReminder } from "../src/logic.js";
import { searchSport, parseDay, windows } from "../src/search.js";
import { sports } from "../src/sports/index.js";
import { londonTime } from "../src/venues/fixture.js";

test("winner: most votes, tie goes to lower option", () => {
  assert.equal(winner([{ idx: 2 }, { idx: 3 }, { idx: 3 }, { idx: 2 }]), 2);
  assert.equal(winner([{ idx: 1 }, { idx: 4 }, { idx: 4 }]), 4);
  assert.equal(winner([]), undefined);
});

test("roster: first N in, rest waitlist", () => {
  const r = buildRoster(["a", "b", "c", "d", "e"], 4);
  assert.deepEqual(r.map((x) => x.status), ["in", "in", "in", "in", "waitlist"]);
});

test("waitlist: reliable players first, then queue order", () => {
  const r = buildRoster(["a", "b", "c", "d"], 1);
  assert.equal(nextOnWaitlist(r)?.player_id, "b");
  assert.equal(nextOnWaitlist(r, { b: 2 })?.player_id, "c");
  assert.equal(nextOnWaitlist(r.map((x) => ({ ...x, status: "in" as const }))), undefined);
});

test("share rounds up", () => {
  assert.equal(share(2400, 4), 600);
  assert.equal(share(2500, 3), 834);
  assert.throws(() => share(2400, 0));
});

test("reminders fire once each, 30m wins when both due", () => {
  const start = 10 * 3600_000;
  const none = { reminded_2h: false, reminded_30m: false };
  assert.equal(dueReminder(start, start - 3 * 3600_000, none), undefined);
  assert.equal(dueReminder(start, start - 90 * 60_000, none), "2h");
  assert.equal(dueReminder(start, start - 20 * 60_000, { reminded_2h: true, reminded_30m: false }), "30m");
  assert.equal(dueReminder(start, start - 20 * 60_000, { reminded_2h: true, reminded_30m: true }), undefined);
  assert.equal(dueReminder(start, start + 1, none), undefined);
});

test("search merges venues sorted by time; every sport has venues", async () => {
  for (const s of Object.values(sports)) assert.ok(s.venues.length >= 2, s.id);
  const slots = await searchSport("badminton", "2026-10-24");
  assert.equal(slots.length, 16);
  assert.deepEqual(slots.map((s) => s.start), [...slots.map((s) => s.start)].sort());
  await assert.rejects(searchSport("curling", "2026-10-24"));
});

test("parseDay", () => {
  const thu = new Date("2026-10-22T12:00:00Z");
  assert.equal(parseDay("sat", thu), "2026-10-24");
  assert.equal(parseDay("thu", thu), "2026-10-29");
  assert.equal(parseDay("tomorrow", thu), "2026-10-23");
  assert.equal(parseDay("2026-11-01", thu), "2026-11-01");
  assert.throws(() => parseDay("someday", thu));
});

test("londonTime handles BST and GMT", () => {
  assert.equal(londonTime("2026-10-24", 18).toISOString(), "2026-10-24T17:00:00.000Z"); // BST
  assert.equal(londonTime("2026-11-07", 18).toISOString(), "2026-11-07T18:00:00.000Z"); // GMT
});

test("windows: back-to-back slots at one venue, cheapest venue per time", async () => {
  const w = windows(await searchSport("badminton", "2026-10-24"), 2);
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  assert.deepEqual(w.map((x) => `${fmt(x.start)}-${fmt(x.end)} ${x.venueId} ${x.courtPricePence}`), [
    "10:00-12:00 better-islington 2400",
    "11:00-13:00 better-islington 2400",
    "12:00-14:00 ea-westminster 2200",
    "13:00-15:00 ea-westminster 2200",
    "15:00-17:00 better-islington 2400",
    "18:00-20:00 better-islington 2400",
    "19:00-21:00 ea-westminster 2200",
    "20:00-22:00 ea-westminster 2200",
  ]);
  assert.equal(windows(await searchSport("badminton", "2026-10-24"), 1).length, 12); // distinct start hours
});

test("window labels", async () => {
  process.env.SUPABASE_URL ??= "http://x"; process.env.SUPABASE_SERVICE_KEY ??= "x";
  const { windowLabel } = await import("../src/club.js");
  const mk = (a: string, b: string) => ({ start: a, end: b } as Parameters<typeof windowLabel>[0]);
  assert.equal(windowLabel(mk("2026-10-24T11:00:00Z", "2026-10-24T13:00:00Z")), "12–2pm");
  assert.equal(windowLabel(mk("2026-10-24T10:00:00Z", "2026-10-24T12:00:00Z")), "11am–1pm");
  assert.equal(windowLabel(mk("2026-10-24T17:30:00Z", "2026-10-24T19:30:00Z")), "6:30–8:30pm");
});
