import type { Sport } from "./types.js";
import { badminton } from "./badminton.js";
import { tennis } from "./tennis.js";

// Add a sport: create src/sports/<sport>.ts and list it here.
export const sports: Record<string, Sport> = Object.fromEntries(
  [badminton, tennis].map((s) => [s.id, s]),
);
