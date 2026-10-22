import type { Sport } from "./types.js";
import { fixtureVenue } from "../venues/fixture.js";

export const tennis: Sport = {
  id: "tennis",
  name: "Tennis",
  playersPerCourt: 4,
  sessionHours: 2,
  venues: [
    fixtureVenue({
      id: "clubspark-highbury", name: "Highbury Fields Tennis", sport: "tennis",
      hours: [9, 10, 11, 14, 15, 18, 19], minutes: 60, pricePence: 750,
      bookingUrl: "https://clubspark.lta.org.uk/HighburyFields/Booking/BookByDate",
      address: "Highbury Fields Tennis Courts, London N5 1AR",
    }),
    fixtureVenue({
      id: "clubspark-regents", name: "Regent's Park Tennis Centre", sport: "tennis",
      hours: [10, 11, 12, 16, 17, 18], minutes: 60, pricePence: 1000,
      bookingUrl: "https://clubspark.lta.org.uk/RegentsParkTennisCentre/Booking/BookByDate",
      address: "Regent's Park Tennis Centre, York Bridge, London NW1 4NR",
    }),
  ],
};
