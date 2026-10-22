// Organiser dashboard: live roster and payments. Supabase Realtime pushes changes to the page over SSE.
import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { db, must } from "./db.js";

export function startDashboard(port: number) {
  const clients = new Set<ServerResponse>();
  db.channel("club")
    .on("postgres_changes", { event: "*", schema: "public", table: "rsvps" }, () => clients.forEach((c) => c.write("data: change\n\n")))
    .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => clients.forEach((c) => c.write("data: change\n\n")))
    .on("postgres_changes", { event: "*", schema: "public", table: "votes" }, () => clients.forEach((c) => c.write("data: change\n\n")))
    .subscribe();

  createServer(async (req, res) => {
    try {
      if (req.url === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.flushHeaders(); // so the page sees the stream open now, not on the first change
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (req.url === "/api/state") {
        const sessions = must(await db.from("sessions").select("*").neq("status", "done").order("id", { ascending: false }).limit(5)) as { id: number }[];
        const ids = sessions.map((s) => s.id);
        const [rsvps, slots, votes, schedules, recent] = await Promise.all([
          ids.length ? db.from("rsvps").select("session_id, player_id, status, position, paid, players(name)").in("session_id", ids).order("position") : { data: [], error: null },
          ids.length ? db.from("slots").select("session_id, idx, payload").in("session_id", ids).order("idx") : { data: [], error: null },
          ids.length ? db.from("votes").select("session_id, player_id, idx").in("session_id", ids) : { data: [], error: null },
          db.from("schedules").select("sport, play_day, players, post_dow, post_hour, close_after_hours, last_posted"),
          db.from("sessions").select("id, sport, venue_name, start_at, court_price_pence").eq("status", "done").order("id", { ascending: false }).limit(5),
        ]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sessions, rsvps: must(rsvps), slots: must(slots), votes: must(votes), schedules: must(schedules), recent: must(recent) }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(await readFile(new URL("../web/index.html", import.meta.url)));
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  }).listen(port, () => console.log(`Dashboard: http://localhost:${port}`));
}
