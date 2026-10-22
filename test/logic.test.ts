import { test } from "node:test";
import assert from "node:assert/strict";
import { winner, buildRoster, nextOnWaitlist, share, dueReminder } from "../src/logic.js";
import { searchSport, parseDay } from "../src/search.js";
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
  assert.equal(slots.length, 6);
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
