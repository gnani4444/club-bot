// WhatsApp transport via Baileys (unofficial). Use a spare number: WhatsApp may ban automated accounts.
import makeWASocket, { useMultiFileAuthState, DisconnectReason, decryptPollVote, jidNormalizedUser, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import { createHash } from "node:crypto";
import pino from "pino";
import qrcode from "qrcode-terminal";
import type { Chat } from "./club.js";

export interface Handlers {
  group(chat: Chat, groupJid: string, sender: string, name: string | null, text: string, mentions: string[]): Promise<unknown>;
  dm(chat: Chat, ids: string[], text: string): Promise<unknown>;
  pollVote(groupJid: string, voter: string, idxs: number[]): Promise<unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startWhatsApp(h: Handlers): Promise<Chat> {
  let sock: WASocket;
  // Sent polls, kept to decrypt votes (Baileys rc14 no longer decrypts them itself).
  // shortcut: kept in memory, so taps on polls sent before a restart are ignored (typed replies still work).
  const polls = new Map<string, { msg: WAMessage; hashes: string[]; onVote?: (ids: string[], idxs: number[]) => Promise<unknown> }>();

  // One outgoing message per second to stay under WhatsApp's spam radar.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (fn: () => Promise<unknown>) => {
    const p = queue.then(fn).then(() => sleep(1000));
    queue = p.catch((e) => { console.error("[wa send]", e); });
    return p.then(() => undefined);
  };

  const chat: Chat = {
    send: (jid, text, mentions) => enqueue(() => sock.sendMessage(jid, { text, mentions })),
    poll: (jid, name, values, opts) =>
      enqueue(async () => {
        // selectableCount 0 = tick any number
        const msg = await sock.sendMessage(jid, { poll: { name, values, selectableCount: opts?.single ? 1 : 0 } });
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
      if (type !== "notify") return;
      for (const m of messages) {
        try { await route(m); } catch (e) { console.error("[handler]", e); }
      }
    });
  };

  /** Sender's JIDs without device suffix: primary first (group: participant, DM: chat), then the phone/@lid alternative. */
  const senderIds = (m: WAMessage) => {
    const group = m.key.remoteJid!.endsWith("@g.us");
    return (group ? [m.key.participant, m.key.participantAlt] : [m.key.remoteJid, m.key.remoteJidAlt])
      .filter(Boolean).map((j) => jidNormalizedUser(j!));
  };

  const route = async (m: WAMessage) => {
    const jid = m.key.remoteJid;
    if (!jid || m.key.fromMe || !m.message) return;
    const isGroup = jid.endsWith("@g.us");

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
          const ids = senderIds(m);
          if (poll.onVote) { if (idxs.length) await poll.onVote(ids, idxs); }
          else if (isGroup) await h.pollVote(jid, ids[0], idxs);
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
      await h.group(chat, jid, senderIds(m)[0], m.pushName ?? null, text, mentions.map((j) => jidNormalizedUser(j)));
    } else {
      await h.dm(chat, senderIds(m), text);
    }
  };

  await connect();
  return chat;
}
