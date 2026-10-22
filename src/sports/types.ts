export interface Slot {
  sport: string;
  venueId: string;
  venueName: string;
  start: string; // ISO 8601
  end: string;
  courtPricePence: number;
  bookingUrl: string;
  mapsUrl: string;
}

export interface VenueAdapter {
  id: string;
  name: string;
  search(date: string): Promise<Slot[]>; // date = YYYY-MM-DD, Europe/London
}

export interface Sport {
  id: string;
  name: string;
  playersPerCourt: number;
  venues: VenueAdapter[];
}
