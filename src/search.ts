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

/**
 * Group free slots into playable windows of `hours` length: back-to-back slots at the same venue.
 * One option per time window (the cheapest venue offering it), sorted by start time.
 */
export function windows(slots: Slot[], hours: number): Slot[] {
  const best = new Map<string, Slot>();
  for (const w of venueWindows(slots, hours)) {
    const prev = best.get(w.start);
    if (!prev || w.courtPricePence < prev.courtPricePence) best.set(w.start, w);
  }
  return [...best.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** Every playable window of `hours` at every venue (back-to-back slots at the same venue). */
export function venueWindows(slots: Slot[], hours: number): Slot[] {
  const byVenue = new Map<string, Slot[]>();
  for (const s of slots) byVenue.set(s.venueId, [...(byVenue.get(s.venueId) ?? []), s]);
  const out: Slot[] = [];
  for (const list of byVenue.values()) {
    list.sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < list.length; i++) {
      const run = [list[i]];
      while (run.length < 100 && Date.parse(run[run.length - 1].end) - Date.parse(run[0].start) < hours * 3600_000) {
        const next = list[i + run.length];
        if (!next || next.start !== run[run.length - 1].end) break;
        run.push(next);
      }
      const end = run[run.length - 1].end;
      if (Date.parse(end) - Date.parse(run[0].start) !== hours * 3600_000) continue;
      out.push({ ...run[0], end, courtPricePence: run.reduce((t, s) => t + s.courtPricePence, 0) });
    }
  }
  return out;
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
