import type { Slot, VenueAdapter } from "../sports/types.js";

// shortcut: venue sites have no public API (Better returns 422, Clubspark 500 to direct calls),
// so slots are generated from each venue's typical timetable. Replace search() with a live fetch per venue when available.
export function fixtureVenue(v: {
  id: string; name: string; sport: string; hours: number[]; minutes: number;
  pricePence: number; bookingUrl: string; address: string;
}): VenueAdapter {
  return {
    id: v.id,
    name: v.name,
    async search(date) {
      return v.hours.map((h): Slot => {
        const start = londonTime(date, h);
        const end = new Date(start.getTime() + v.minutes * 60_000);
        return {
          sport: v.sport, venueId: v.id, venueName: v.name,
          start: start.toISOString(), end: end.toISOString(),
          courtPricePence: v.pricePence, bookingUrl: v.bookingUrl,
          mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(v.address)}`,
        };
      });
    },
  };
}

/** YYYY-MM-DD + hour in Europe/London -> Date (handles BST/GMT). */
export function londonTime(date: string, hour: number): Date {
  const guess = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  const londonHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(guess),
  );
  return new Date(guess.getTime() - (londonHour - hour) * 3600_000);
}
