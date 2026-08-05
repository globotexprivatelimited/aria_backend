import type { CanonicalCheckin } from "./contract";

/**
 * Adapters map a specific system's payload into the canonical check-in shape.
 * Add one function per PMS as hotels need them. The 20-second form and the
 * generic JSON path are just the first two adapters.
 */

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v).trim());

/** Already-canonical JSON (our own form, Zapier, a well-behaved integration). */
export function fromGeneric(hotelId: string, body: Raw): Partial<CanonicalCheckin> {
  return {
    hotelId,
    guestName: str(body.guestName ?? body.name ?? body.guest_name),
    phone: str(body.phone ?? body.whatsapp ?? body.mobile ?? body.contact),
    room: str(body.room ?? body.roomNumber ?? body.room_no),
    checkoutAt: body.checkoutAt ? str(body.checkoutAt) : body.checkout ? str(body.checkout) : undefined,
    source: "generic",
  };
}

/** eZee-style payload (field names differ). Illustrative - refine when the pilot needs it. */
export function fromEzee(hotelId: string, body: Raw): Partial<CanonicalCheckin> {
  return {
    hotelId,
    guestName: str(body.GuestName ?? body.guest_name),
    phone: str(body.Mobile ?? body.Phone),
    room: str(body.RoomNo ?? body.Room),
    checkoutAt: body.DepartureDate ? str(body.DepartureDate) : undefined,
    source: "ezee",
  };
}

/** Hotelogix-style payload. Illustrative. */
export function fromHotelogix(hotelId: string, body: Raw): Partial<CanonicalCheckin> {
  return {
    hotelId,
    guestName: str(body.guestFullName ?? body.name),
    phone: str(body.contactNumber ?? body.phone),
    room: str(body.roomId ?? body.room),
    checkoutAt: body.checkOutDate ? str(body.checkOutDate) : undefined,
    source: "hotelogix",
  };
}

/** One CSV/sheet row (Excel hotels: bulk import at onboarding). Header names are flexible. */
export function fromCsvRow(hotelId: string, row: Raw): Partial<CanonicalCheckin> {
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const hit = Object.keys(row).find((rk) => rk.toLowerCase().trim() === k);
      if (hit) return str(row[hit]);
    }
    return "";
  };
  return {
    hotelId,
    guestName: pick("name", "guest", "guest name", "guestname"),
    phone: pick("phone", "whatsapp", "mobile", "number"),
    room: pick("room", "room number", "roomno", "room no"),
    checkoutAt: pick("checkout", "checkout date", "departure") || undefined,
    source: "csv",
  };
}

const ADAPTERS: Record<string, (hotelId: string, body: Raw) => Partial<CanonicalCheckin>> = {
  generic: fromGeneric,
  ezee: fromEzee,
  hotelogix: fromHotelogix,
  csv: fromCsvRow,
};

export function adapterFor(name?: string) {
  return ADAPTERS[(name ?? "generic").toLowerCase()] ?? fromGeneric;
}
