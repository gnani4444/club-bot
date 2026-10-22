import type { Sport } from "./types.js";
import { fixtureVenue } from "../venues/fixture.js";

export const badminton: Sport = {
  id: "badminton",
  name: "Badminton",
  playersPerCourt: 4,
  sessionHours: 2,
  venues: [
    fixtureVenue({
      id: "better-islington", name: "Better · Islington Tennis Centre", sport: "badminton",
      hours: [10, 11, 12, 13, 15, 16, 18, 19, 20], minutes: 60, pricePence: 1200,
      bookingUrl: "https://bookings.better.org.uk/location/islington-tennis-centre/badminton-60min",
      address: "Islington Tennis Centre, Market Road, London N7 9PL",
    }),
    fixtureVenue({
      id: "ea-westminster", name: "Everyone Active · Seymour Leisure Centre", sport: "badminton",
      hours: [12, 13, 14, 17, 19, 20, 21], minutes: 60, pricePence: 1100,
      bookingUrl: "https://www.everyoneactive.com/centre/seymour-leisure-centre/",
      address: "Seymour Leisure Centre, Seymour Place, London W1H 5TJ",
    }),
  ],
};
