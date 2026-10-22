import type { Sport } from "./types.js";
import { fixtureVenue } from "../venues/fixture.js";

export const badminton: Sport = {
  id: "badminton",
  name: "Badminton",
  playersPerCourt: 4,
  venues: [
    fixtureVenue({
      id: "better-islington", name: "Better · Islington Tennis Centre", sport: "badminton",
      hours: [18, 19, 20], minutes: 60, pricePence: 2400,
      bookingUrl: "https://bookings.better.org.uk/location/islington-tennis-centre/badminton-60min",
      address: "Islington Tennis Centre, Market Road, London N7 9PL",
    }),
    fixtureVenue({
      id: "ea-westminster", name: "Everyone Active · Seymour Leisure Centre", sport: "badminton",
      hours: [17, 19, 21], minutes: 60, pricePence: 2200,
      bookingUrl: "https://www.everyoneactive.com/centre/seymour-leisure-centre/",
      address: "Seymour Leisure Centre, Seymour Place, London W1H 5TJ",
    }),
  ],
};
