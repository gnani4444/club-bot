import { sports } from "./sports/index.js";
import type { Slot } from "./sports/types.js";

export async function searchSport(sportId: string, date: string): Promise<Slot[]> {
  const sport = sports[sportId];
  if (!sport) throw new Error(`Unknown sport "${sportId}". Try: ${Object.keys(sports).join(", ")}`);
  const results = await Promise.allSettled(sport.venues.map((v) => v.search(date)));
  return results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) => a.start.localeCompare(b.start) || a.courtPricePence - b.courtPricePence);
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// "today" | "tomorrow" | "sat" | "2026-10-24" -> YYYY-MM-DD
export function parseDay(word: string | undefined, now = new Date()): string {
  const w = (word ?? "tomorrow").toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  const d = new Date(now);
  if (w === "tomorrow") d.setDate(d.getDate() + 1);
  else if (w !== "today") {
    const target = DAYS.indexOf(w.slice(0, 3));
    if (target < 0) throw new Error(`Can't read day "${word}". Use today, tomorrow, mon..sun or YYYY-MM-DD.`);
    d.setDate(d.getDate() + (((target - d.getDay()) + 7) % 7 || 7));
  }
  return d.toISOString().slice(0, 10);
}
