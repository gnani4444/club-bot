// End-to-end run of the whole club flow against the real Supabase in .env, with a fake WhatsApp.
// Usage: npm run e2e. Creates rows under a fake group and deletes them at the end.
import assert from "node:assert/strict";
try { process.loadEnvFile(".env"); } catch { /* shell env */ }
process.env.OFFER_TIMEOUT_SEC = "1";

const { onGroup, onDm, onPollVote, tick } = await import("../src/club.js");
const { db } = await import("../src/db.js");

const G = "e2e-test@g.us";
const [org, a, b, c, d, e] = ["org", "a", "b", "c", "d", "e"].map((x) => `e2e-${x}@s.whatsapp.net`);
const sent: { to: string; text: string }[] = [];
const chat = {
  async send(to: string, text: string) { sent.push({ to, text }); },
  async poll(to: string, name: string, options: string[]) { sent.push({ to, text: `[POLL] ${name}\n${options.join("\n")}` }); },
};
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
  assert.match(last(G), /\[POLL\] Badminton/); console.log(last(G));

  step("votes: numbers + poll vote, re-vote overrides");
  await g(a, "2"); await g(b, "2"); await g(c, "1"); await g(d, "2");
  await onPollVote(G, e, 2); await g(c, "2"); // c changes mind
  await g(org, "!close");
  console.log(last(G)); assert.match(last(G), /Option 2 wins/);
  assert.match(last(org), /Book it here/);

  step("booked");
  await g(org, "!booked"); assert.match(last(G), /Court booked/); console.log(last(G));
  await g(org, "1"); // votes after close are ignored

  step("pay + paid");
  await g(org, "!pay"); console.log(last(G)); assert.match(last(G), /÷ 4 = £/);
  assert.match(last(a), /Your share/);
  await g(org, "!paid", [a]); assert.match(last(G), /Payment noted/);

  step("remind (forced) + scheduled tick does nothing yet");
  await g(org, "!remind"); assert.match(last(a), /Reply OUT/); console.log(last(a));

  step("KILLER DEMO: OUT -> waitlist offered -> IN");
  await onDm(chat, [b], "out");
  assert.match(last(G), /dropped out/); assert.match(last(c), /spot opened up/); console.log(last(c));
  await onDm(chat, [c], "IN"); assert.match(last(G), /takes the spot/); console.log(last(G));

  step("drop-out with empty waitlist");
  await onDm(chat, [d], "OUT");
  assert.match(last(G), /waitlist is empty/);

  step("DM edge cases");
  await onDm(chat, ["e2e-stranger@s.whatsapp.net"], "OUT"); assert.match(last("e2e-stranger@s.whatsapp.net"), /not on any upcoming/);
  await onDm(chat, [a], "IN"); assert.match(last(a), /already playing/);
  await onDm(chat, [b], "IN"); assert.match(last(b), /not on any upcoming/); // dropped out earlier
  assert.equal(await onDm(chat, [a], "hello"), false);

  step("status + ask + done");
  await g(org, "!status"); console.log(last(G));
  await g(org, "!ask who drops out most?"); console.log(last(G));
  await g(org, "!done"); assert.match(last(G), /Session closed/);
  await tick(chat);

  console.log(`\nALL E2E STEPS PASSED (${sent.length} messages)`);
} finally {
  await db.from("sessions").delete().eq("group_jid", G);
  await db.from("votes").delete().like("player_id", "e2e-%");
  await db.from("rsvps").delete().like("player_id", "e2e-%");
  await db.from("players").delete().like("id", "e2e-%");
}
