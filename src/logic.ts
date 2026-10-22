// Pure rules, unit-tested in test/logic.test.ts.

export interface Rsvp { player_id: string; status: "in" | "out" | "waitlist" | "offered"; position: number }

/** Winning option: most votes, ties go to the lower option number. */
export function winner(votes: { idx: number }[]): number | undefined {
  const tally = new Map<number, number>();
  for (const v of votes) tally.set(v.idx, (tally.get(v.idx) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}

/** Voters for the winning slot in vote order: first `capacity` play, rest wait. */
export function buildRoster(voters: string[], capacity: number): Rsvp[] {
  return voters.map((player_id, i) => ({
    player_id, position: i + 1, status: i < capacity ? "in" : "waitlist",
  }));
}

/** Next waitlisted player to offer a spot to: fewest past drop-outs, then queue order. */
export function nextOnWaitlist(rsvps: Rsvp[], outs: Record<string, number> = {}): Rsvp | undefined {
  return rsvps
    .filter((r) => r.status === "waitlist")
    .sort((a, b) => (outs[a.player_id] ?? 0) - (outs[b.player_id] ?? 0) || a.position - b.position)[0];
}

/** Per-player share in pence, rounded up so the organiser is never short. */
export function share(courtPricePence: number, players: number): number {
  if (players < 1) throw new Error("No players to split between");
  return Math.ceil(courtPricePence / players);
}

export const pounds = (p: number) => `£${(p / 100).toFixed(2)}`;

/** Which reminder is due, if any. */
export function dueReminder(
  startMs: number, nowMs: number, r: { reminded_2h: boolean; reminded_30m: boolean },
): "2h" | "30m" | undefined {
  const left = startMs - nowMs;
  if (left <= 0) return undefined;
  if (left <= 30 * 60_000 && !r.reminded_30m) return "30m";
  if (left <= 120 * 60_000 && !r.reminded_2h) return "2h";
  return undefined;
}
