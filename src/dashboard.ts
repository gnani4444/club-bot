// Organiser dashboard: live roster and payments. Supabase Realtime pushes changes to the page over SSE.
import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { db, must } from "./db.js";

export function startDashboard(port: number) {
  const clients = new Set<ServerResponse>();
  db.channel("club")
    .on("postgres_changes", { event: "*", schema: "public", table: "rsvps" }, () => clients.forEach((c) => c.write("data: change\n\n")))
    .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => clients.forEach((c) => c.write("data: change\n\n")))
    .subscribe();

  createServer(async (req, res) => {
    try {
      if (req.url === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (req.url === "/api/state") {
        const sessions = must(await db.from("sessions").select("*").neq("status", "done").order("id", { ascending: false }).limit(5));
        const ids = (sessions as { id: number }[]).map((s) => s.id);
        const rsvps = ids.length ? must(await db.from("rsvps").select("session_id, status, position, paid, players(name)").in("session_id", ids).order("position")) : [];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sessions, rsvps }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(await readFile(new URL("../web/index.html", import.meta.url)));
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  }).listen(port, () => console.log(`Dashboard: http://localhost:${port}`));
}
