// npm run search -- badminton sat
import { searchSport, parseDay } from "./search.js";
const [sport = "badminton", day] = process.argv.slice(2);
const slots = await searchSport(sport, parseDay(day));
console.table(slots.map((s) => ({ when: new Date(s.start).toLocaleString("en-GB", { timeZone: "Europe/London" }), venue: s.venueName, price: s.courtPricePence / 100 })));
