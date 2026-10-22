// Club workflow: commands from the WhatsApp group and replies in DMs. Transport-agnostic (see wa.ts).
import { db, must } from "./db.js";
import { searchSport, parseDay, windows } from "./search.js";
import { sports } from "./sports/index.js";
import type { Slot } from "./sports/types.js";
import { winner, buildRoster, nextOnWaitlist, share, pounds, dueReminder, type Rsvp } from "./logic.js";
import { paymentLink, remember, ask, notionLog } from "./sponsors.js";

export interface Chat {
  /** Group members' JIDs, excluding the bot. */
  members(groupJid: string): Promise<string[]>;
  send(jid: string, text: string, mentions?: string[]): Promise<void>;
  /** Tappable poll. With onVote, taps go to that callback (voter's JIDs, chosen 1-based options). */
  poll(jid: string, name: string, options: string[], opts?: { single?: boolean; onVote?: (ids: string[], idxs: number[]) => Promise<unknown> }): Promise<void>;
}

interface Schedule {
  group_jid: string; sport: string; play_day: string; players: number | null; organiser: string;
  post_dow: number; post_hour: number; close_after_hours: number; last_posted: string | null;
}

interface Session {
  organiser?: string | null; auto_close_at?: string | null;
  id: number; sport: string; group_jid: string; status: string;
  venue_name: string | null; start_at: string | null; end_at: string | null;
  court_price_pence: number | null; capacity: number | null;
  booking_url: string | null; maps_url: string | null; pay_link: string | null;
}
type RsvpRow = Rsvp & { session_id: number; offered_at: string | null; reminded_2h: boolean; reminded_30m: boolean; paid: boolean; players: { name: string | null } | null };

const OFFER_TIMEOUT_MS = Number(process.env.OFFER_TIMEOUT_SEC ?? 900) * 1000;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const hour = (iso: string) => {
  const [h, m] = new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s/g, "").toLowerCase().split(/(?=[ap]m)/);
  return { t: h.replace(":00", ""), ap: m };
};
/** "12–2pm", "11am–1pm" */
export const windowLabel = (s: Slot) => {
  const a = hour(s.start), b = hour(s.end);
  return a.ap === b.ap ? `${a.t}–${b.t}${b.ap}` : `${a.t}${a.ap}–${b.t}${b.ap}`;
};
const MAX_POLL_OPTIONS = 12; // WhatsApp limit
const AUTO_CLOSE_HOURS = 48;
const label = (s: Session) => `${sports[s.sport]?.name ?? s.sport} · ${s.venue_name} · ${s.start_at ? when(s.start_at) : "TBC"}`;
const at = (jid: string) => `@${jid.split("@")[0]}`;

export async function upsertPlayer(id: string, name?: string | null) {
  must(await db.from("players").upsert({ id, ...(name ? { name } : {}) }, { onConflict: "id" }));
}

async function openSession(groupJid: string, statuses: string[]): Promise<Session | undefined> {
  const rows = must(await db.from("sessions").select("*").eq("group_jid", groupJid).in("status", statuses).order("id", { ascending: false }).limit(1));
  return (rows as Session[])[0];
}

async function rsvps(sessionId: number): Promise<RsvpRow[]> {
  return must(await db.from("rsvps").select("*, players(name)").eq("session_id", sessionId).order("position")) as RsvpRow[];
}

async function rosterText(s: Session): Promise<{ text: string; mentions: string[] }> {
  const rows = await rsvps(s.id);
  const line = (r: RsvpRow) => `${at(r.player_id)}${r.paid ? " ✅" : ""}`;
  const playing = rows.filter((r) => r.status === "in");
  const waiting = rows.filter((r) => r.status === "waitlist" || r.status === "offered");
  const text = [
    `*${label(s)}*`,
    `Playing (${playing.length}/${s.capacity}): ${playing.map(line).join(", ") || "-"}`,
    `Waitlist: ${waiting.map((r) => `${at(r.player_id)}${r.status === "offered" ? " (offered)" : ""}`).join(", ") || "-"}`,
  ].join("\n");
  return { text, mentions: rows.map((r) => r.player_id) };
}

async function postRoster(chat: Chat, s: Session, header?: string) {
  const r = await rosterText(s);
  await chat.send(s.group_jid, header ? `${header}\n\n${r.text}` : r.text, r.mentions);
}

const HELP = [
  "*Club Bot*",
  "!play <sport> [day] [players]  find courts and start a vote (sports: " + Object.keys(sports).join(", ") + ")",
  "1 3  vote by number, several allowed (or tick the poll)",
  "!close  pick the winning slot and make the roster",
  "!weekly <sport> <day> [players]  auto-post the poll every Monday 10:00 (!weekly off to stop)",
  "!booked  confirm the court is booked",
  "!pay  split the cost and DM payment links",
  "!paid @name  mark someone as paid",
  "!remind  send reminders now",
  "!status  show the roster",
  "!done  close the session",
  "!ask <question>  ask club memory",
  "DM the bot OUT to drop out, IN to take an offered spot.",
].join("\n");

/** Group message. Returns true if handled. */
export async function onGroup(chat: Chat, groupJid: string, sender: string, senderName: string | null, text: string, mentions: string[]): Promise<boolean> {
  const t = text.trim();
  const numbers = /^\d{1,2}([\s,]+\d{1,2})*$/.test(t);
  if (!t.startsWith("!") && !numbers) return false;
  await upsertPlayer(sender, senderName);
  const [cmd, ...args] = t.split(/\s+/);

  if (numbers) {
    const s = await openSession(groupJid, ["polling"]);
    if (s && !s.venue_name) {
      await recordVotes(s.id, sender, t.split(/[\s,]+/).map(Number));
      await closeIfEveryoneVoted(chat, s);
    }
    return !!s;
  }

  switch (cmd.toLowerCase()) {
    case "!help":
      await chat.send(groupJid, HELP);
      return true;

    case "!play":
      await startPoll(chat, groupJid, args[0], args[1], Number(args[2]), sender);
      return true;

    case "!close":
      await closeVote(chat, groupJid, sender);
      return true;

    case "!weekly": {
      if ((args[0] ?? "").toLowerCase() === "off") {
        must(await db.from("schedules").delete().eq("group_jid", groupJid));
        await chat.send(groupJid, "Weekly poll stopped.");
        return true;
      }
      if (!args[0]) {
        const sch = (must(await db.from("schedules").select("*").eq("group_jid", groupJid)) as Schedule[])[0];
        await chat.send(groupJid, sch ? scheduleText(sch) : "No weekly poll. Set one: !weekly badminton sat [players]");
        return true;
      }
      const sport = args[0].toLowerCase();
      try { parseDay(args[1] ?? "sat"); } catch (e) { await chat.send(groupJid, (e as Error).message); return true; }
      if (!sports[sport]) { await chat.send(groupJid, `Unknown sport "${sport}". Try: ${Object.keys(sports).join(", ")}`); return true; }
      const sch: Schedule = { group_jid: groupJid, sport, play_day: (args[1] ?? "sat").toLowerCase(), players: Number(args[2]) > 0 ? Number(args[2]) : null, organiser: sender, post_dow: 1, post_hour: 10, close_after_hours: 48, last_posted: null };
      must(await db.from("schedules").upsert(sch));
      await chat.send(groupJid, `✅ ${scheduleText(sch)}`);
      return true;
    }

    case "!booked":
      await markBooked(chat, groupJid);
      return true;

    case "!pay": {
      const s = await openSession(groupJid, ["booked"]);
      if (!s) { await chat.send(groupJid, "No booked session."); return true; }
      const playing = (await rsvps(s.id)).filter((r) => r.status === "in");
      const each = share(s.court_price_pence ?? 0, playing.length);
      const link = await paymentLink(label(s), each);
      must(await db.from("sessions").update({ pay_link: link }).eq("id", s.id));
      for (const r of playing) {
        if (!r.paid) await chat.send(r.player_id, `${label(s)}\nYour share: ${pounds(each)}\nPay here: ${link}`);
      }
      await chat.send(groupJid, `${pounds(s.court_price_pence ?? 0)} ÷ ${playing.length} = ${pounds(each)} each. Links sent by DM.`);
      return true;
    }

    case "!paid": {
      const s = await openSession(groupJid, ["booked"]);
      if (!s || !mentions.length) { await chat.send(groupJid, "Usage: !paid @name"); return true; }
      must(await db.from("rsvps").update({ paid: true }).eq("session_id", s.id).in("player_id", mentions));
      await postRoster(chat, s, "Payment noted.");
      return true;
    }

    case "!remind": {
      const s = await openSession(groupJid, ["booked"]);
      if (!s) { await chat.send(groupJid, "No booked session."); return true; }
      for (const r of (await rsvps(s.id)).filter((r) => r.status === "in")) await remind(chat, s, r.player_id);
      await chat.send(groupJid, "Reminders sent.");
      return true;
    }

    case "!status": {
      const s = await openSession(groupJid, ["polling", "booked"]);
      if (s?.venue_name) await postRoster(chat, s);
      else await chat.send(groupJid, s ? "Vote in progress." : "No session. Start one with !play <sport> [day].");
      return true;
    }

    case "!done": {
      const s = await openSession(groupJid, ["booked"]);
      if (!s) { await chat.send(groupJid, "No booked session."); return true; }
      must(await db.from("sessions").update({ status: "done" }).eq("id", s.id));
      const rows = await rsvps(s.id);
      const lines = rows.map((r) => `${r.players?.name ?? r.player_id}: ${r.status}${r.status === "in" ? (r.paid ? ", paid" : ", NOT paid") : ""}`);
      await notionLog(label(s), [`Court: ${pounds(s.court_price_pence ?? 0)}`, ...lines]);
      remember(`${label(s)} finished. ${lines.join("; ")}.`);
      await chat.send(groupJid, `Session closed. Thanks all!`);
      return true;
    }

    case "!ask":
      await chat.send(groupJid, await ask(args.join(" ")));
      return true;
  }
  return false;
}

/** Replace a player's choices for this vote. Unknown option numbers are dropped. */
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const scheduleText = (s: Schedule) =>
  `Weekly ${sports[s.sport]?.name ?? s.sport} poll for ${s.play_day} every ${DOW[s.post_dow]} ${s.post_hour}:00, closes after ${s.close_after_hours}h. Stop with !weekly off`;

/** Post the time-window poll for a sport and day. */
async function startPoll(chat: Chat, groupJid: string, sportArg: string | undefined, dayArg: string | undefined, players: number, organiser: string, closeAt?: Date, now = new Date()) {
  const sport = (sportArg ?? "").toLowerCase();
  let date: string, slots: Slot[];
  try {
    date = parseDay(dayArg, now);
    slots = windows(await searchSport(sport, date), sports[sport]?.sessionHours ?? 1).slice(0, MAX_POLL_OPTIONS);
  } catch (e) {
    await chat.send(groupJid, (e as Error).message);
    return;
  }
  if (!slots.length) { await chat.send(groupJid, `No ${sport} courts free on ${date}.`); return; }
  const capacity = players > 0 ? players : sports[sport].playersPerCourt; // e.g. 2 for singles
  const autoClose = (closeAt ?? new Date(now.getTime() + AUTO_CLOSE_HOURS * 3600_000)).toISOString();
  const s = must(await db.from("sessions").insert({ sport, group_jid: groupJid, capacity, organiser, auto_close_at: autoClose }).select().single()) as Session;
  must(await db.from("slots").insert(slots.map((p, i) => ({ session_id: s.id, idx: i + 1, payload: p }))));
  const day = new Date(slots[0].start).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
  const closes = ` Closes ${when(autoClose)} or when everyone has voted.`;
  await chat.poll(groupJid, `${sports[sport].name} ${day}: pick every time you can play (or reply e.g. 1 3).${closes}`,
    slots.map((p) => `${windowLabel(p)} · from ${pounds(Math.ceil(p.courtPricePence / capacity))}pp`));
}

/** Pick the winning window, build roster + waitlist, send the organiser the booking link. */
async function closeVote(chat: Chat, groupJid: string, organiser: string) {
  const s = await openSession(groupJid, ["polling"]);
  if (!s || s.venue_name) { await chat.send(groupJid, "No vote running. Start one with !play <sport> [day]."); return; }
  const votes = must(await db.from("votes").select("player_id, idx").eq("session_id", s.id).order("voted_at")) as { player_id: string; idx: number }[];
  const win = winner(votes);
  if (!win) {
    const expired = s.auto_close_at && Date.parse(s.auto_close_at) <= Date.now();
    if (expired) must(await db.from("sessions").update({ status: "done" }).eq("id", s.id));
    await chat.send(groupJid, expired ? "Nobody voted, so no game this time. See you next week!" : "No votes yet.");
    return;
  }
  const slot = (must(await db.from("slots").select("payload").eq("session_id", s.id).eq("idx", win).single()) as { payload: Slot }).payload;
  // Players free for the winning window first (in vote order), then everyone else who voted, as waitlist.
  const voters = [...new Set([...votes.filter((v) => v.idx === win), ...votes].map((v) => v.player_id))];
  const roster = buildRoster(voters, s.capacity ?? 4);
  const upd = {
    venue_name: slot.venueName, start_at: slot.start, end_at: slot.end,
    court_price_pence: slot.courtPricePence, booking_url: slot.bookingUrl, maps_url: slot.mapsUrl,
  };
  must(await db.from("sessions").update(upd).eq("id", s.id));
  must(await db.from("rsvps").upsert(roster.map((r) => ({ ...r, session_id: s.id }))));
  const done = { ...s, ...upd };
  await postRoster(chat, done, `${windowLabel(slot)} wins (${votes.filter((v) => v.idx === win).length} free). Booking now.`);
  const who = s.organiser ?? organiser;
  const msg = `📅 Book ${label(done)} here:\n${slot.bookingUrl}`;
  await chat.send(groupJid, `${msg}\n\n${at(who)} tap ✅ below once it's booked.`, [who]);
  await chat.poll(groupJid, "Court booked?", ["✅ Booked it"], { single: true, onVote: (ids, idxs) => idxs.includes(1) && ids.includes(who) ? markBooked(chat, groupJid) : Promise.resolve() });
  await chat.send(who, msg);
  const names = (await rsvps(s.id)).filter((r) => r.status === "in").map((r) => r.players?.name ?? r.player_id);
  remember(`${label(done)} chosen by vote. Players: ${names.join(", ")}.`);
}

/** Weekly schedules: post due polls, auto-close expired ones. */
async function runSchedules(chat: Chat, now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).map((p) => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  for (const sch of must(await db.from("schedules").select("*")) as Schedule[]) {
    if (sch.post_dow === dow && Number(parts.hour) >= sch.post_hour && sch.last_posted !== today) {
      must(await db.from("schedules").update({ last_posted: today }).eq("group_jid", sch.group_jid));
      await startPoll(chat, sch.group_jid, sch.sport, sch.play_day, sch.players ?? 0, sch.organiser, new Date(now.getTime() + sch.close_after_hours * 3600_000), now);
    }
  }
  const due = must(await db.from("sessions").select("*").eq("status", "polling").is("venue_name", null).lte("auto_close_at", now.toISOString())) as Session[];
  for (const s of due) await closeVote(chat, s.group_jid, s.organiser ?? s.group_jid);
}

async function markBooked(chat: Chat, groupJid: string) {
  const s = await openSession(groupJid, ["polling"]);
  if (!s?.venue_name) { await chat.send(groupJid, "Nothing to book. Run !close first."); return; }
  must(await db.from("sessions").update({ status: "booked" }).eq("id", s.id));
  await postRoster(chat, { ...s, status: "booked" }, "✅ Court booked!");
}

export async function recordVotes(sessionId: number, playerId: string, idxs: number[]) {
  await upsertPlayer(playerId);
  const valid = (must(await db.from("slots").select("idx").eq("session_id", sessionId)) as { idx: number }[]).map((r) => r.idx);
  const picks = [...new Set(idxs)].filter((i) => valid.includes(i));
  must(await db.from("votes").delete().match({ session_id: sessionId, player_id: playerId }));
  const now = new Date().toISOString();
  // upsert: one poll tap can arrive as two updates at once
  if (picks.length) must(await db.from("votes").upsert(picks.map((idx) => ({ session_id: sessionId, player_id: playerId, idx, voted_at: now })), { ignoreDuplicates: true }));
}

/** Poll vote from WhatsApp poll UI (full current selection): newest polling session in the group. */
export async function onPollVote(chat: Chat, groupJid: string, voter: string, idxs: number[]) {
  const s = await openSession(groupJid, ["polling"]);
  if (!s || s.venue_name) return;
  await recordVotes(s.id, voter, idxs);
  await closeIfEveryoneVoted(chat, s);
}

/** Close the vote early once every group member has voted. */
async function closeIfEveryoneVoted(chat: Chat, s: Session) {
  let members: string[];
  try { members = await chat.members(s.group_jid); } catch { return; }
  const voted = new Set((must(await db.from("votes").select("player_id").eq("session_id", s.id)) as { player_id: string }[]).map((v) => v.player_id));
  if (members.length && members.every((m) => voted.has(m))) {
    await chat.send(s.group_jid, "Everyone has voted, closing the poll.");
    await closeVote(chat, s.group_jid, s.organiser ?? s.group_jid);
  }
}

/** Direct message. `ids` = every JID WhatsApp gave for the sender (phone JID and/or @lid). */
export async function onDm(chat: Chat, ids: string[], text: string): Promise<boolean> {
  const word = text.trim().toUpperCase();
  if (word !== "OUT" && word !== "IN") return false;
  const rows = must(await db.from("rsvps").select("*, sessions!inner(*)").in("player_id", ids)
    .in("status", ["in", "offered", "waitlist"]).neq("sessions.status", "done")
    .order("session_id", { ascending: false }).limit(1)) as (RsvpRow & { sessions: Session })[];
  const r = rows[0];
  if (!r) { await chat.send(ids[0], "You're not on any upcoming session."); return true; }
  const s = r.sessions, key = { session_id: s.id, player_id: r.player_id };

  if (word === "OUT") {
    must(await db.from("rsvps").update({ status: "out" }).match(key));
    if (r.status === "in") {
      const p = must(await db.from("players").select("outs").eq("id", r.player_id).single()) as { outs: number };
      must(await db.from("players").update({ outs: p.outs + 1 }).eq("id", r.player_id));
      remember(`${r.players?.name ?? r.player_id} dropped out of ${label(s)}.`);
      await chat.send(r.player_id, "No worries, you're out. Finding a replacement.");
      await chat.send(s.group_jid, `${at(r.player_id)} dropped out. Offering the spot to the waitlist…`, [r.player_id]);
    } else {
      await chat.send(r.player_id, "OK, you're off the list.");
    }
    if (r.status !== "waitlist") await offerNext(chat, s);
    return true;
  }

  // IN
  if (r.status === "offered") {
    must(await db.from("rsvps").update({ status: "in", offered_at: null }).match(key));
    await chat.send(r.player_id, `You're in! ${label(s)}\n${s.maps_url ?? ""}`);
    await postRoster(chat, s, `🎉 ${at(r.player_id)} takes the spot.`);
  } else if (r.status === "in") {
    await chat.send(r.player_id, "👍 You're in. See you there!");
  } else {
    await chat.send(r.player_id, "You're on the waitlist. I'll DM you if a spot opens.");
  }
  return true;
}

async function offerNext(chat: Chat, s: Session) {
  const rows = await rsvps(s.id);
  const outs = Object.fromEntries((must(await db.from("players").select("id, outs").in("id", rows.map((r) => r.player_id))) as { id: string; outs: number }[]).map((p) => [p.id, p.outs]));
  const next = nextOnWaitlist(rows, outs);
  if (!next) { await chat.send(s.group_jid, `A spot is open for ${label(s)} and the waitlist is empty. Anyone?`); return; }
  must(await db.from("rsvps").update({ status: "offered", offered_at: new Date().toISOString() }).match({ session_id: s.id, player_id: next.player_id }));
  const mins = Math.round(OFFER_TIMEOUT_MS / 60_000) || 1;
  await chat.send(next.player_id, `A spot opened up! ${label(s)}\nTap below within ${mins} min (or reply IN / OUT).`);
  await chat.poll(next.player_id, "Want the spot?", ["✅ Take the spot", "❌ Pass"], { single: true, onVote: (ids, idxs) => tapReply(chat, ids, idxs, "IN", "OUT") });
}

async function remind(chat: Chat, s: Session, playerId: string, kind?: "2h" | "30m") {
  const start = s.start_at ? new Date(s.start_at) : undefined;
  const mins = start ? Math.max(0, Math.round((start.getTime() - Date.now()) / 60_000)) : undefined;
  const lead = kind === "30m" ? "Starting in 30 minutes" : kind === "2h" ? "Starting in 2 hours" : mins !== undefined ? `Starts in ${Math.floor(mins / 60)}h ${mins % 60}m` : "Reminder";
  await chat.send(playerId, `⏰ ${lead}: ${label(s)}\n📍 ${s.maps_url ?? ""}\nCan't make it? Tap below (or reply OUT) so someone else can play.`);
  await chat.poll(playerId, "Still coming?", ["✅ I'm coming", "❌ Can't make it"], { single: true, onVote: (ids, idxs) => tapReply(chat, ids, idxs, "IN", "OUT") });
}

/** Poll tap -> same path as typing the word. Option 1 = yes, option 2 = no. */
async function tapReply(chat: Chat, ids: string[], idxs: number[], yes: string, no: string) {
  if (idxs.includes(2)) await onDm(chat, ids, no);
  else if (idxs.includes(1)) await onDm(chat, ids, yes);
}

/** Every tick: due reminders and expired waitlist offers. */
export { runSchedules };

export async function tick(chat: Chat) {
  await runSchedules(chat, new Date());
  const now = Date.now();
  const booked = must(await db.from("sessions").select("*").eq("status", "booked")) as Session[];
  for (const s of booked) {
    const rows = await rsvps(s.id);
    for (const r of rows) {
      if (r.status === "in" && s.start_at) {
        const due = dueReminder(new Date(s.start_at).getTime(), now, r);
        if (due) {
          await remind(chat, s, r.player_id, due);
          must(await db.from("rsvps").update(due === "30m" ? { reminded_2h: true, reminded_30m: true } : { reminded_2h: true }).match({ session_id: s.id, player_id: r.player_id }));
        }
      }
      if (r.status === "offered" && r.offered_at && now - new Date(r.offered_at).getTime() > OFFER_TIMEOUT_MS) {
        must(await db.from("rsvps").update({ status: "out" }).match({ session_id: s.id, player_id: r.player_id }));
        await chat.send(r.player_id, "Offer expired, the spot went to the next person.");
        await offerNext(chat, s);
      }
    }
  }
}
