// WhatsApp transport via Baileys (unofficial). Use a spare number: WhatsApp may ban automated accounts.
import makeWASocket, { useMultiFileAuthState, DisconnectReason, decryptPollVote, jidNormalizedUser, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import { createHash } from "node:crypto";
import pino from "pino";
import qrcode from "qrcode-terminal";
import type { Chat } from "./club.js";

export interface Handlers {
  group(chat: Chat, groupJid: string, sender: string, name: string | null, text: string, mentions: string[]): Promise<unknown>;
  dm(chat: Chat, ids: string[], text: string): Promise<unknown>;
  pollVote(chat: Chat, groupJid: string, voterIds: string[], idxs: number[]): Promise<unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startWhatsApp(h: Handlers): Promise<Chat> {
  let sock: WASocket;
  // Sent polls, kept to decrypt votes (Baileys rc14 no longer decrypts them itself).
  // shortcut: kept in memory, so taps on polls sent before a restart are ignored (typed replies still work).
  const sentIds = new Set<string>(); // our own outgoing messages, so we never react to them
  const polls = new Map<string, { msg: WAMessage; hashes: string[]; onVote?: (ids: string[], idxs: number[]) => Promise<unknown> }>();

  // One outgoing message per second to stay under WhatsApp's spam radar.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (fn: () => Promise<unknown>) => {
    const p = queue.then(fn).then(() => sleep(1000));
    queue = p.catch((e) => { console.error("[wa send]", e); });
    return p.then(() => undefined);
  };

  const chat: Chat = {
    members: async (jid) => {
      const meta = await sock.groupMetadata(jid);
      // Includes the bot's own number: its phone can play too.
      const people = await Promise.all(meta.participants.map((p) => identities(p.id, (p as { phoneNumber?: string }).phoneNumber)));
      return people.map((ids) => ids[0]);
    },
    send: (jid, text, mentions) => enqueue(async () => {
      const msg = await sock.sendMessage(await reachable(jid), { text, mentions });
      if (msg?.key.id) sentIds.add(msg.key.id);
    }),
    poll: (jid, name, values, opts) =>
      enqueue(async () => {
        // selectableCount 0 = tick any number
        const msg = await sock.sendMessage(await reachable(jid), { poll: { name, values, selectableCount: opts?.single ? 1 : 0 } });
        if (msg?.key.id) sentIds.add(msg.key.id);
        if (msg?.key.id) polls.set(msg.key.id, { msg, hashes: values.map((v) => createHash("sha256").update(v).digest("hex")), onVote: opts?.onVote });
      }),
  };

  const connect = async () => {
    const { state, saveCreds } = await useMultiFileAuthState(".auth");
    sock = makeWASocket({ auth: state, logger: pino({ level: "warn" }) });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) qrcode.generate(qr, { small: true });
      if (connection === "open") {
        console.log("WhatsApp connected as", sock.user?.id);
        // Join the club group from its invite link (no-op if already a member).
        const code = process.env.WHATSAPP_INVITE?.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/)?.[1];
        if (code) sock.groupAcceptInvite(code).then((g) => console.log("In group", g)).catch((e) => console.warn("[invite]", e.message));
      }
      if (connection === "close") {
        const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) console.error("Logged out. Delete .auth/ and scan the QR again.");
        else setTimeout(connect, 2000);
      }
    });
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      for (const m of messages) {
        // Taps/messages from the bot's own phone may arrive as "append"; skip old history either way.
        const recent = Date.now() / 1000 - Number(m.messageTimestamp ?? 0) < 120;
        if (type !== "notify" && !(m.key.fromMe && recent)) continue;
        try { await route(m); } catch (e) { console.error("[handler]", e); }
      }
    });
  };

  /**
   * Every JID for one person, device suffix removed, phone JID first (DMs to @lid don't reliably arrive).
   * WhatsApp often sends only the @lid form (e.g. on poll taps), so the other form comes from Baileys' LID map.
   */
  const identities = async (...jids: (string | null | undefined)[]) => {
    const out = new Set(jids.filter(Boolean).map((j) => jidNormalizedUser(j!)));
    for (const j of [...out]) {
      const other = j.endsWith("@lid")
        ? await sock.signalRepository.lidMapping.getPNForLID(j).catch(() => null)
        : await sock.signalRepository.lidMapping.getLIDForPN(j).catch(() => null);
      if (other) out.add(jidNormalizedUser(other));
    }
    return [...out].sort((a, b) => Number(b.endsWith("@s.whatsapp.net")) - Number(a.endsWith("@s.whatsapp.net")));
  };
  const senderIds = (m: WAMessage) =>
    m.key.remoteJid!.endsWith("@g.us") ? identities(m.key.participant, m.key.participantAlt) : identities(m.key.remoteJid, m.key.remoteJidAlt);
  const myIds = () => identities(sock.user?.id, sock.user?.lid);
  /** DMs to @lid addresses don't reliably arrive: send to the phone JID when we know it. */
  const reachable = async (jid: string) => (jid.endsWith("@lid") ? (await identities(jid))[0] : jid);

  const route = async (m: WAMessage) => {
    const jid = m.key.remoteJid;
    if (!jid || !m.message || (m.key.id && sentIds.has(m.key.id))) return;
    const isGroup = jid.endsWith("@g.us");
    // The bot's own phone is a player too: its taps and messages arrive as fromMe.
    const from = m.key.fromMe ? await myIds() : await senderIds(m);

    const vote = m.message.pollUpdateMessage;
    if (vote) {
      const poll = polls.get(vote.pollCreationMessageKey?.id ?? "");
      const secret = poll?.msg.message?.messageContextInfo?.messageSecret;
      if (!poll || !secret || !vote.vote) return;
      // Vote is signed with device-free JIDs, phone or @lid depending on the chat: try each pairing.
      const creators = [sock.user?.id, sock.user?.lid];
      const voters = m.key.fromMe ? creators : isGroup ? [m.key.participant, m.key.participantAlt] : [jid, m.key.remoteJidAlt];
      for (const c of creators.filter(Boolean).map((j) => jidNormalizedUser(j!))) {
        for (const v of voters.filter(Boolean).map((j) => jidNormalizedUser(j!))) {
          let idxs: number[];
          try {
            const dec = decryptPollVote(vote.vote, { pollEncKey: secret, pollMsgId: poll.msg.key.id!, pollCreatorJid: c, voterJid: v });
            // Each update carries the voter's full current selection (empty = all unticked).
            idxs = (dec.selectedOptions ?? []).map((o) => poll.hashes.indexOf(Buffer.from(o).toString("hex")) + 1).filter((i) => i > 0);
          } catch { continue; /* wrong pairing */ }
          const ids = from;
          console.log("[poll tap]", ids[0], idxs);
          if (poll.onVote) { if (idxs.length) await poll.onVote(ids, idxs); }
          else if (isGroup) await h.pollVote(chat, jid, ids, idxs);
          return;
        }
      }
      console.warn("[poll] could not decrypt vote; players can reply with the option number instead");
      return;
    }

    const text = m.message.conversation ?? m.message.extendedTextMessage?.text;
    if (!text) return;
    if (isGroup) {
      const mentions = m.message.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
      await h.group(chat, jid, from[0], m.pushName ?? null, text, mentions.map((j) => jidNormalizedUser(j)));
    } else {
      await h.dm(chat, from, text);
    }
  };

  await connect();
  return chat;
}
