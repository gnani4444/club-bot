// One-off: post a message to the club group as the bot. Stop `npm start` first (one session at a time).
// Usage: npx tsx scripts/say.ts "<group jid>" "<text>"
import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";

const [jid, text] = process.argv.slice(2);
if (!jid || !text) throw new Error('Usage: npx tsx scripts/say.ts "<group jid>" "<text>"');
const { state, saveCreds } = await useMultiFileAuthState(".auth");
const sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }) });
sock.ev.on("creds.update", saveCreds);
sock.ev.on("connection.update", async ({ connection }) => {
  if (connection !== "open") return;
  await sock.sendMessage(jid, { text });
  console.log("sent");
  setTimeout(() => process.exit(0), 2000);
});
setTimeout(() => { console.error("timeout"); process.exit(1); }, 30000);
