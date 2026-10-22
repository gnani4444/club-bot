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
let members = [org, a, b, c, d, e];
const chat = {
  async members() { return members; },
  async send(to: string, text: string) { sent.push({ to, text }); },
  async poll(to: string, name: string, options: string[], opts?: { onVote?: OnVote }) { sent.push({ to, text: `[POLL] ${name}\n${options.join("\n")}`, onVote: opts?.onVote }); },
};
/** Simulate tapping option(s) on the newest poll sent to `who`. */
const tap = (who: string, ...idxs: number[]) => [...sent].reverse().find((m) => m.to === who && m.onVote)!.onVote!([who], idxs);
/** Simulate `who` tapping the newest group poll that has a callback. */
const tapGroup = (who: string, ...idxs: number[]) => [...sent].reverse().find((m) => m.to === G && m.onVote)!.onVote!([who], idxs);
const any = (to: string, re: RegExp) => sent.some((m) => m.to === to && re.test(m.text));
const last = (to: string) => [...sent].reverse().find((m) => m.to === to)?.text ?? "";
const step = (name: string) => console.log(`\n=== ${name} ===`);
const g = (who: string, text: string, mentions: string[] = []) => onGroup(chat, G, who, who.split("@")[0], text, mentions);

try {
  step("help + bad input");
  await g(org, "!help"); assert.match(last(G), /!play/);
  await g(org, "!play curling sat"); assert.match(last(G), /Unknown sport/);
  await g(org, "!close"); assert.match(last(G), /No vote running/);

  step("play: search + poll");
  await g(org, "!play badminton sat 4"); // explicit 4: default is now 2
  assert.ok(any(G, /\[POLL\] Badminton[\s\S]*12–2pm/));
  assert.match(last(G), /\[POLL\] 📍 Where\?[\s\S]*Better[\s\S]*Everyone Active/); console.log(last(G));

  step("votes: numbers + poll vote, re-vote overrides");
  await g(a, "2 3"); await g(b, "2"); await g(c, "1"); await g(d, "2, 5, 99"); // multi-choice; 99 ignored
  await onPollVote(chat, G, [e], [2]); await g(c, "2"); // c changes mind (replaces "1")
  await g(org, "!close");
  assert.ok(sent.some((m) => m.to === G && /11am–1pm wins \(5 free\)/.test(m.text)));
  assert.match(last(G), /\[POLL\] Court booked\?/); assert.match(last(org), /Book .* here/);

  step("booked: only the organiser's tap counts");
  await tapGroup(a, 1); assert.match(last(G), /\[POLL\] Court booked\?/);
  await tapGroup(org, 1); assert.ok(any(G, /Court booked!/));
  await g(org, "1"); // votes after close are ignored

  step("pay: automatic after booking, tap to confirm");
  assert.ok(any(G, /£24.00 ÷ 4 = £6.00 each/)); assert.ok(any(a, /Your share: £6.00/));
  assert.match(last(a), /\[POLL\] Tap once you've paid/);
  await tap(d, 1); assert.match(last(d), /payment noted/); assert.match(last(G), /@e2e-d paid/);
  await g(org, "!paid", [a]); assert.match(last(G), /Payment noted/);
  await g(org, "!pay"); assert.match(last(G), /÷ 4 = £6.00/); // re-send to anyone unpaid

  step("remind (forced) + scheduled tick does nothing yet");
  await g(org, "!remind"); assert.match(last(a), /\[POLL\] Still coming\?/);
  await tap(a, 1); assert.match(last(a), /You're in/);

  step("KILLER DEMO: OUT -> waitlist offered -> IN");
  await tap(b, 2); // b taps "Can't make it" on the reminder
  assert.match(last(G), /dropped out/); assert.match(last(c), /Want the spot/);
  await tap(c, 1); // c taps "Take the spot" assert.match(last(G), /takes the spot/); console.log(last(G));

  step("untick the winning time in the poll = drop out");
  await onPollVote(chat, G, [e], [3]); // e unticks 11am–1pm (option 2)
  assert.ok(sent.some((m) => m.to === G && /@e2e-e dropped out/.test(m.text)));

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
  assert.ok(any(G, /\[POLL\] Badminton Sat 31 Oct.*Closes/));
  const polls = sent.length;
  await runSchedules(chat, new Date("2026-10-26T11:30:00Z")); // same day: no double post
  assert.equal(sent.length, polls);
  await g(a, "1 2"); await g(b, "2"); // c never votes, so no early close
  await runSchedules(chat, new Date("2026-10-28T11:00:00Z")); // Wed, past 48h auto-close
  assert.match(last(G), /\[POLL\] Court booked\?/);
  assert.ok(sent.some((m) => m.to === G && /wins \(2 free\)/.test(m.text)));
  await g(org, "!weekly off"); assert.match(last(G), /stopped/);

  step("poll closes as soon as every member has voted");
  members = [a, b];
  await g(org, "!play tennis sat 2"); assert.ok(any(G, /\[POLL\] Tennis.*or when everyone has voted/));
  await g(a, "2"); // 10am–12pm: free at both venues (Highbury is cheaper)
  await tapGroup(a, 2); await tapGroup(b, 2); // venue poll: both prefer Regent's Park
  assert.ok(!any(G, /Everyone has voted/)); // b hasn't voted on the time yet
  await onPollVote(chat, G, [b], [2]);
  assert.ok(any(G, /Everyone has voted/));
  assert.ok(any(G, /10am–12pm wins[\s\S]*Regent's Park/), "venue poll beats cheapest venue");
  assert.match(last(G), /\[POLL\] Court booked\?/);

  console.log(`\nALL E2E STEPS PASSED (${sent.length} messages)`);
} finally {
  await db.from("sessions").delete().eq("group_jid", G);
  await db.from("schedules").delete().eq("group_jid", G);
  await db.from("votes").delete().like("player_id", "e2e-%");
  await db.from("rsvps").delete().like("player_id", "e2e-%");
  await db.from("players").delete().like("id", "e2e-%");
}
