// WhatsApp transport via Baileys (unofficial). Use a spare number: WhatsApp may ban automated accounts.
import makeWASocket, { useMultiFileAuthState, DisconnectReason, decryptPollVote, getKeyAuthor, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import { createHash } from "node:crypto";
import pino from "pino";
import qrcode from "qrcode-terminal";
import type { Chat } from "./club.js";

export interface Handlers {
  group(chat: Chat, groupJid: string, sender: string, name: string | null, text: string, mentions: string[]): Promise<unknown>;
  dm(chat: Chat, ids: string[], text: string): Promise<unknown>;
  pollVote(groupJid: string, voter: string, idx: number): Promise<unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startWhatsApp(h: Handlers): Promise<Chat> {
  let sock: WASocket;
  // Sent polls, kept to decrypt votes (Baileys rc14 no longer decrypts them itself).
  const polls = new Map<string, { msg: WAMessage; hashes: string[] }>();

  // One outgoing message per second to stay under WhatsApp's spam radar.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (fn: () => Promise<unknown>) => {
    const p = queue.then(fn).then(() => sleep(1000));
    queue = p.catch((e) => { console.error("[wa send]", e); });
    return p.then(() => undefined);
  };

  const chat: Chat = {
    send: (jid, text, mentions) => enqueue(() => sock.sendMessage(jid, { text, mentions })),
    poll: (jid, name, values) =>
      enqueue(async () => {
        const msg = await sock.sendMessage(jid, { poll: { name, values, selectableCount: 1 } });
        if (msg?.key.id) polls.set(msg.key.id, { msg, hashes: values.map((v) => createHash("sha256").update(v).digest("hex")) });
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

  const route = async (m: WAMessage) => {
    const jid = m.key.remoteJid;
    if (!jid || m.key.fromMe || !m.message) return;
    const isGroup = jid.endsWith("@g.us");

    const vote = m.message.pollUpdateMessage;
    if (vote && isGroup) {
      const poll = polls.get(vote.pollCreationMessageKey?.id ?? "");
      const secret = poll?.msg.message?.messageContextInfo?.messageSecret;
      if (!poll || !secret || !vote.vote) return;
      // Try both of our identities (phone JID and @lid): WhatsApp signs with whichever the group uses.
      for (const me of [sock.user?.id, sock.user?.lid].filter(Boolean) as string[]) {
        try {
          const dec = decryptPollVote(vote.vote, {
            pollEncKey: secret, pollMsgId: poll.msg.key.id!,
            pollCreatorJid: getKeyAuthor(poll.msg.key, me), voterJid: getKeyAuthor(m.key, me),
          });
          const picked = dec.selectedOptions?.[0];
          if (picked) {
            const idx = poll.hashes.indexOf(Buffer.from(picked).toString("hex")) + 1;
            if (idx > 0) await h.pollVote(jid, m.key.participant!, idx);
          }
          return;
        } catch { /* wrong identity, try next */ }
      }
      console.warn("[poll] could not decrypt vote; players can reply with the option number instead");
      return;
    }

    const text = m.message.conversation ?? m.message.extendedTextMessage?.text;
    if (!text) return;
    if (isGroup) {
      const mentions = m.message.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
      await h.group(chat, jid, m.key.participant!, m.pushName ?? null, text, mentions);
    } else {
      const ids = [jid, m.key.remoteJidAlt].filter(Boolean) as string[];
      await h.dm(chat, ids, text);
    }
  };

  await connect();
  return chat;
}
