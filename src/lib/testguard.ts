/** +999 is not an assigned country code - numbers like it only ever come from test harnesses, never from a guest. */
export function isTestNumber(phone: string | null | undefined): boolean {
  return /^\+999/.test(String(phone ?? "").replace(/[^0-9+]/g, ""));
}

/** Hotels that may hold test guests: the Test Hotel by default, or the ids listed in TEST_HOTEL_IDS. */
export function isTestHotel(hotelId: string): boolean {
  return (process.env.TEST_HOTEL_IDS ?? "18").split(",").map((s) => s.trim()).includes(String(hotelId));
}

export const TEST_GUEST_REFUSED = "Test numbers (+999...) cannot be checked into a live hotel - use the Test Hotel.";
