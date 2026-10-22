// Club workflow: commands from the WhatsApp group and replies in DMs. Transport-agnostic (see wa.ts).
import { db, must } from "./db.js";
import { searchSport, parseDay } from "./search.js";
import { sports } from "./sports/index.js";
import type { Slot } from "./sports/types.js";
import { winner, buildRoster, nextOnWaitlist, share, pounds, dueReminder, type Rsvp } from "./logic.js";
import { paymentLink, remember, ask, notionLog } from "./sponsors.js";

export interface Chat {
  send(jid: string, text: string, mentions?: string[]): Promise<void>;
  poll(jid: string, name: string, options: string[]): Promise<void>;
}

interface Session {
  id: number; sport: string; group_jid: string; status: string;
  venue_name: string | null; start_at: string | null; end_at: string | null;
  court_price_pence: number | null; capacity: number | null;
  booking_url: string | null; maps_url: string | null; pay_link: string | null;
}
type RsvpRow = Rsvp & { session_id: number; offered_at: string | null; reminded_2h: boolean; reminded_30m: boolean; paid: boolean; players: { name: string | null } | null };

const OFFER_TIMEOUT_MS = Number(process.env.OFFER_TIMEOUT_SEC ?? 900) * 1000;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const slotLabel = (s: Slot) => `${when(s.start)} · ${s.venueName} · ${pounds(s.courtPricePence)}`;
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
  "!play <sport> [day]  find courts and start a vote (sports: " + Object.keys(sports).join(", ") + ")",
  "1-5  vote by number (or use the poll)",
  "!close  pick the winning slot and make the roster",
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
  if (!t.startsWith("!") && !/^[1-9]$/.test(t)) return false;
  await upsertPlayer(sender, senderName);
  const [cmd, ...args] = t.split(/\s+/);

  if (/^[1-9]$/.test(t)) {
    const s = await openSession(groupJid, ["polling"]);
    if (s && !s.venue_name) await recordVote(s.id, sender, Number(t));
    return !!s;
  }

  switch (cmd.toLowerCase()) {
    case "!help":
      await chat.send(groupJid, HELP);
      return true;

    case "!play": {
      const sport = (args[0] ?? "").toLowerCase();
      let date: string, slots: Slot[];
      try {
        date = parseDay(args[1]);
        slots = (await searchSport(sport, date)).slice(0, 5);
      } catch (e) {
        await chat.send(groupJid, (e as Error).message);
        return true;
      }
      if (!slots.length) { await chat.send(groupJid, `No ${sport} courts free on ${date}.`); return true; }
      const s = must(await db.from("sessions").insert({ sport, group_jid: groupJid, capacity: sports[sport].playersPerCourt }).select().single()) as Session;
      must(await db.from("slots").insert(slots.map((p, i) => ({ session_id: s.id, idx: i + 1, payload: p }))));
      await chat.poll(groupJid, `${sports[sport].name} ${date}: which slot? (or reply 1-${slots.length})`, slots.map((p, i) => `${i + 1}. ${slotLabel(p)}`));
      return true;
    }

    case "!close": {
      const s = await openSession(groupJid, ["polling"]);
      if (!s) { await chat.send(groupJid, "No vote running. Start one with !play <sport> [day]."); return true; }
      const votes = must(await db.from("votes").select("player_id, idx").eq("session_id", s.id).order("voted_at")) as { player_id: string; idx: number }[];
      const win = winner(votes);
      if (!win) { await chat.send(groupJid, "No votes yet."); return true; }
      const slot = (must(await db.from("slots").select("payload").eq("session_id", s.id).eq("idx", win).single()) as { payload: Slot }).payload;
      // Winning-slot voters first, then everyone else who voted, so they become the waitlist.
      const voters = [...votes.filter((v) => v.idx === win), ...votes.filter((v) => v.idx !== win)].map((v) => v.player_id);
      const roster = buildRoster(voters, s.capacity ?? 4);
      const upd = {
        venue_name: slot.venueName, start_at: slot.start, end_at: slot.end,
        court_price_pence: slot.courtPricePence, booking_url: slot.bookingUrl, maps_url: slot.mapsUrl,
      };
      must(await db.from("sessions").update(upd).eq("id", s.id));
      must(await db.from("rsvps").upsert(roster.map((r) => ({ ...r, session_id: s.id }))));
      const done = { ...s, ...upd };
      await postRoster(chat, done, `Option ${win} wins. Booking now.`);
      await chat.send(sender, `Book it here (one tap): ${slot.bookingUrl}\nThen send !booked in the group.`);
      const names = (await rsvps(s.id)).filter((r) => r.status === "in").map((r) => r.players?.name ?? r.player_id);
      remember(`${label(done)} chosen by vote. Players: ${names.join(", ")}.`);
      return true;
    }

    case "!booked": {
      const s = await openSession(groupJid, ["polling"]);
      if (!s?.venue_name) { await chat.send(groupJid, "Nothing to book. Run !close first."); return true; }
      must(await db.from("sessions").update({ status: "booked" }).eq("id", s.id));
      await postRoster(chat, { ...s, status: "booked" }, "✅ Court booked!");
      return true;
    }

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

export async function recordVote(sessionId: number, playerId: string, idx: number) {
  await upsertPlayer(playerId);
  must(await db.from("votes").upsert({ session_id: sessionId, player_id: playerId, idx, voted_at: new Date().toISOString() }));
}

/** Poll vote from WhatsApp poll UI: newest polling session in the group. */
export async function onPollVote(groupJid: string, voter: string, idx: number) {
  const s = await openSession(groupJid, ["polling"]);
  if (s && !s.venue_name) await recordVote(s.id, voter, idx);
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
    await chat.send(r.player_id, "You're already playing.");
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
  await chat.send(next.player_id, `A spot opened up! ${label(s)}\nReply IN within ${mins} min to take it, or OUT to pass.`);
}

async function remind(chat: Chat, s: Session, playerId: string, kind?: "2h" | "30m") {
  const start = s.start_at ? new Date(s.start_at) : undefined;
  const mins = start ? Math.max(0, Math.round((start.getTime() - Date.now()) / 60_000)) : undefined;
  const lead = kind === "30m" ? "Starting in 30 minutes" : kind === "2h" ? "Starting in 2 hours" : mins !== undefined ? `Starts in ${Math.floor(mins / 60)}h ${mins % 60}m` : "Reminder";
  await chat.send(playerId, `⏰ ${lead}: ${label(s)}\n📍 ${s.maps_url ?? ""}\nCan't make it? Reply OUT so someone else can play.`);
}

/** Every tick: due reminders and expired waitlist offers. */
export async function tick(chat: Chat) {
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
