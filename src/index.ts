try { process.loadEnvFile(".env"); } catch { /* env may come from the shell */ }

const { startWhatsApp } = await import("./wa.js");
const { onGroup, onDm, onPollVote, tick } = await import("./club.js");
const { startDashboard } = await import("./dashboard.js");

startDashboard(Number(process.env.PORT ?? 3000));
const chat = await startWhatsApp({ group: onGroup, dm: onDm, pollVote: onPollVote });

// Reminders and waitlist offer expiry. 15s keeps the demo snappy.
setInterval(() => tick(chat).catch((e) => console.error("[tick]", e)), 15_000);
