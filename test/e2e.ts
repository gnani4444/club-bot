// End-to-end run of the whole club flow against the real Supabase in .env, with a fake WhatsApp.
// Usage: npm run e2e. Creates rows under a fake group and deletes them at the end.
import assert from "node:assert/strict";
try { process.loadEnvFile(".env"); } catch { /* shell env */ }
process.env.OFFER_TIMEOUT_SEC = "1";

const { onGroup, onDm, onPollVote, tick, runSchedules } = await import("../src/club.js");
const { db } = await import("../src/db.js");

const G = "e2e-test@g.us";
const [org, a, b, c, d, e] = ["org", "a", "b", "c", "d", "e"].map((x) => `e2e-${x}@s.whatsapp.net`);
type OnVote = (ids: string[], idxs: number[]) => Promise<unknown>;
const sent: { to: string; text: string; onVote?: OnVote }[] = [];
const chat = {
  async send(to: string, text: string) { sent.push({ to, text }); },
  async poll(to: string, name: string, options: string[], opts?: { onVote?: OnVote }) { sent.push({ to, text: `[POLL] ${name}\n${options.join("\n")}`, onVote: opts?.onVote }); },
};
/** Simulate tapping option(s) on the newest poll sent to `who`. */
const tap = (who: string, ...idxs: number[]) => [...sent].reverse().find((m) => m.to === who && m.onVote)!.onVote!([who], idxs);
const last = (to: string) => [...sent].reverse().find((m) => m.to === to)?.text ?? "";
const step = (name: string) => console.log(`\n=== ${name} ===`);
const g = (who: string, text: string, mentions: string[] = []) => onGroup(chat, G, who, who.split("@")[0], text, mentions);

try {
  step("help + bad input");
  await g(org, "!help"); assert.match(last(G), /!play/);
  await g(org, "!play curling sat"); assert.match(last(G), /Unknown sport/);
  await g(org, "!close"); assert.match(last(G), /No vote running/);

  step("play: search + poll");
  await g(org, "!play badminton sat");
  assert.match(last(G), /\[POLL\] Badminton/); assert.match(last(G), /12–2pm/); console.log(last(G));

  step("votes: numbers + poll vote, re-vote overrides");
  await g(a, "2 3"); await g(b, "2"); await g(c, "1"); await g(d, "2, 5, 99"); // multi-choice; 99 ignored
  await onPollVote(G, e, [2]); await g(c, "2"); // c changes mind (replaces "1")
  await g(org, "!close");
  console.log(last(G)); assert.match(last(G), /11am–1pm wins \(5 free\)/);
  assert.match(last(org), /\[POLL\] Tap once the court is booked/);

  step("booked (organiser taps the poll)");
  await tap(org, 1); assert.match(last(G), /Court booked/); console.log(last(G));
  await g(org, "1"); // votes after close are ignored

  step("pay + paid");
  await g(org, "!pay"); console.log(last(G)); assert.match(last(G), /£24.00 ÷ 4 = £6.00/);
  assert.match(last(a), /Your share/);
  await g(org, "!paid", [a]); assert.match(last(G), /Payment noted/);

  step("remind (forced) + scheduled tick does nothing yet");
  await g(org, "!remind"); assert.match(last(a), /\[POLL\] Still coming\?/);
  await tap(a, 1); assert.match(last(a), /You're in/);

  step("KILLER DEMO: OUT -> waitlist offered -> IN");
  await tap(b, 2); // b taps "Can't make it" on the reminder
  assert.match(last(G), /dropped out/); assert.match(last(c), /Want the spot/);
  await tap(c, 1); // c taps "Take the spot" assert.match(last(G), /takes the spot/); console.log(last(G));

  step("drop-out with empty waitlist");
  await onDm(chat, [d], "OUT");
  assert.match(last(G), /waitlist is empty/);

  step("DM edge cases");
  await onDm(chat, ["e2e-stranger@s.whatsapp.net"], "OUT"); assert.match(last("e2e-stranger@s.whatsapp.net"), /not on any upcoming/);
  await onDm(chat, [a], "IN"); assert.match(last(a), /You're in/);
  await onDm(chat, [b], "IN"); assert.match(last(b), /not on any upcoming/); // dropped out earlier
  assert.equal(await onDm(chat, [a], "hello"), false);

  step("status + ask + done");
  await g(org, "!status"); console.log(last(G));
  await g(org, "!ask who drops out most?"); console.log(last(G));
  await g(org, "!done"); assert.match(last(G), /Session closed/);
  await tick(chat);

  step("weekly: auto-post Monday 10:00, auto-close after 48h");
  await g(org, "!weekly"); assert.match(last(G), /No weekly poll/);
  await g(org, "!weekly badminton sat 2"); assert.match(last(G), /every Monday 10:00/);
  await runSchedules(chat, new Date("2026-10-26T09:30:00Z")); // Mon 09:30 London: too early
  assert.match(last(G), /every Monday/);
  await runSchedules(chat, new Date("2026-10-26T10:30:00Z")); // Mon 10:30 London: posts
  assert.match(last(G), /\[POLL\] Badminton Sat 31 Oct.*Closes/); console.log(last(G).split("\n")[0]);
  const polls = sent.length;
  await runSchedules(chat, new Date("2026-10-26T11:30:00Z")); // same day: no double post
  assert.equal(sent.length, polls);
  await g(a, "1 2"); await g(b, "2");
  await runSchedules(chat, new Date(Date.now() + 49 * 3600_000)); // past auto-close
  assert.match(last(org), /\[POLL\] Tap once the court is booked/);
  assert.match([...sent].reverse().find((m) => m.to === G)!.text, /wins \(2 free\)/);
  await g(org, "!weekly off"); assert.match(last(G), /stopped/);

  console.log(`\nALL E2E STEPS PASSED (${sent.length} messages)`);
} finally {
  await db.from("sessions").delete().eq("group_jid", G);
  await db.from("schedules").delete().eq("group_jid", G);
  await db.from("votes").delete().like("player_id", "e2e-%");
  await db.from("rsvps").delete().like("player_id", "e2e-%");
  await db.from("players").delete().like("id", "e2e-%");
}
