import { prisma } from "../db";
import { log } from "../lib/logger";

/**
 * The knowledge base forms that are structured fields rather than free text:
 *   Form 1 - hotel essentials: check-in and check-out, front desk, Wi-Fi, breakfast, address, house policies
 *   Form 4 - spa rules: advance notice, first and last appointment, pregnancy or medical mentions go to a person
 *   Form 5 - services and prices, one line each
 * and the go-live check: the six mandatory fields must be filled before a hotel is switched on.
 */
export type HotelProfile = {
  checkInTime: string | null; checkOutTime: string | null; frontDeskPhone: string | null; emergencyPhone: string | null;
  wifiName: string | null; wifiPassword: string | null; breakfastHours: string | null; breakfastPlace: string | null;
  address: string | null; parking: string | null; pets: string | null; smoking: string | null; lateCheckout: string | null; earlyCheckin: string | null;
  currency: string | null; languages: string | null; notes: string | null; updatedAt: string | null; updatedBy: string | null;
};
export type ProfileInput = Partial<Omit<HotelProfile, "updatedAt" | "updatedBy">>;
type ProfileKey = keyof ProfileInput;
const PROFILE_COLS: [ProfileKey, string][] = [
  ["checkInTime", "check_in_time"], ["checkOutTime", "check_out_time"], ["frontDeskPhone", "front_desk_phone"], ["emergencyPhone", "emergency_phone"],
  ["wifiName", "wifi_name"], ["wifiPassword", "wifi_password"], ["breakfastHours", "breakfast_hours"], ["breakfastPlace", "breakfast_place"],
  ["address", "address"], ["parking", "parking"], ["pets", "pets"], ["smoking", "smoking"], ["lateCheckout", "late_checkout"], ["earlyCheckin", "early_checkin"],
  ["currency", "currency"], ["languages", "languages"], ["notes", "notes"],
];
/** The six fields a hotel must fill before it goes live - one list, so changing the rule is one edit. */
export const MANDATORY: { key: ProfileKey; label: string }[] = [
  { key: "checkInTime", label: "Check-in time" }, { key: "checkOutTime", label: "Check-out time" }, { key: "frontDeskPhone", label: "Front desk phone" },
  { key: "wifiName", label: "Wi-Fi network" }, { key: "breakfastHours", label: "Breakfast hours" }, { key: "address", label: "Address" },
];

const clean = (v: unknown, max = 300): string | null => { const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : ""; return s || null; };
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export function emptyProfile(): HotelProfile {
  const p = {} as Record<string, string | null>;
  for (const [k] of PROFILE_COLS) p[k] = null;
  return { ...(p as unknown as HotelProfile), updatedAt: null, updatedBy: null };
}
function normProfile(r: any): HotelProfile {
  const p = emptyProfile() as unknown as Record<string, string | null>;
  for (const [k, col] of PROFILE_COLS) p[k] = r[col] ?? null;
  p.updatedAt = iso(r.updated_at); p.updatedBy = r.updated_by ?? null;
  return p as unknown as HotelProfile;
}

/** The profile; an unfilled check-in, check-out, phone or address falls back to what the hotel row already holds. */
export async function getProfile(hotelId: string): Promise<HotelProfile> {
  const [rows, hotel] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>("select * from hotel_profile where hotel_id = $1", hotelId),
    prisma.hotel.findUnique({ where: { hotelId } }).catch(() => null),
  ]);
  const p = rows[0] ? normProfile(rows[0]) : emptyProfile();
  const h = (hotel ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (!p.checkInTime) p.checkInTime = str(h.checkInTime ?? h.check_in_time);
  if (!p.checkOutTime) p.checkOutTime = str(h.checkOutTime ?? h.check_out_time);
  if (!p.frontDeskPhone) p.frontDeskPhone = str(h.contactPhone ?? h.contact_phone);
  if (!p.address) p.address = [str(h.address), str(h.city)].filter(Boolean).join(", ") || null;
  return p;
}

export async function setProfile(hotelId: string, input: ProfileInput, by?: string): Promise<HotelProfile> {
  const cur = (await prisma.$queryRawUnsafe<any[]>("select * from hotel_profile where hotel_id = $1", hotelId))[0] ?? {};
  const cols = PROFILE_COLS.map(([, c]) => c);
  const values = PROFILE_COLS.map(([k, col]) => (input[k] !== undefined ? clean(input[k], k === "notes" ? 1200 : 300) : (cur[col] ?? null)));
  const sql = "insert into hotel_profile (hotel_id, " + cols.join(", ") + ", updated_by) values ($1, " + cols.map((_, i) => "$" + (i + 2)).join(", ") + ", $" + (cols.length + 2) + ") on conflict (hotel_id) do update set " + cols.map((c) => c + " = excluded." + c).join(", ") + ", updated_at = now(), updated_by = excluded.updated_by returning *";
  const rows = await prisma.$queryRawUnsafe<any[]>(sql, hotelId, ...values, by || null);
  log.info("forms: hotel essentials saved", { hotelId, by: by || "?" });
  return normProfile(rows[0]);
}

export function renderProfile(p: HotelProfile, hotelName?: string | null): string {
  const lines: string[] = [];
  if (p.checkInTime || p.checkOutTime) lines.push("- Check-in " + (p.checkInTime ? "from " + p.checkInTime : "time not set") + "; check-out " + (p.checkOutTime ? "by " + p.checkOutTime : "time not set") + (p.lateCheckout ? ". Late check-out: " + p.lateCheckout : "") + (p.earlyCheckin ? ". Early check-in: " + p.earlyCheckin : ""));
  if (p.frontDeskPhone) lines.push("- Front desk: " + p.frontDeskPhone + (p.emergencyPhone ? "; emergencies: " + p.emergencyPhone : ""));
  if (p.wifiName) lines.push("- Wi-Fi: network " + p.wifiName + (p.wifiPassword ? ", password " + p.wifiPassword : ", no password needed"));
  if (p.breakfastHours || p.breakfastPlace) lines.push("- Breakfast: " + (p.breakfastHours ?? "") + (p.breakfastHours && p.breakfastPlace ? " at " : "") + (p.breakfastPlace ?? ""));
  if (p.address) lines.push("- Address: " + p.address);
  if (p.parking) lines.push("- Parking: " + p.parking);
  if (p.pets) lines.push("- Pets: " + p.pets);
  if (p.smoking) lines.push("- Smoking: " + p.smoking);
  if (p.currency) lines.push("- Prices are in " + p.currency);
  if (p.languages) lines.push("- The team speaks " + p.languages);
  if (p.notes) lines.push("- " + p.notes);
  if (!lines.length) return "";
  return "HOTEL ESSENTIALS" + (hotelName ? " - " + hotelName : "") + " (the hotel's own, exact - quote these as they are):\n" + lines.join("\n");
}

/* ---------------------------------------------------------------- Form 4: spa rules ---- */

export type SpaRules = { advanceNoticeMins: number; firstAppointment: string | null; lastAppointment: string | null; medicalToHuman: boolean; cancellation: string | null; ageRule: string | null; notes: string | null; updatedAt: string | null; updatedBy: string | null; set: boolean };
export type SpaRulesInput = Partial<Omit<SpaRules, "updatedAt" | "updatedBy" | "set">>;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const defaultSpaRules = (): SpaRules => ({ advanceNoticeMins: 120, firstAppointment: null, lastAppointment: null, medicalToHuman: true, cancellation: null, ageRule: null, notes: null, updatedAt: null, updatedBy: null, set: false });
function normSpa(r: any): SpaRules {
  return { advanceNoticeMins: Number(r.advance_notice_mins ?? 120), firstAppointment: r.first_appointment ?? null, lastAppointment: r.last_appointment ?? null, medicalToHuman: r.medical_to_human !== false, cancellation: r.cancellation ?? null, ageRule: r.age_rule ?? null, notes: r.notes ?? null, updatedAt: iso(r.updated_at), updatedBy: r.updated_by ?? null, set: true };
}
export function checkSpaRules(s: SpaRulesInput): string | null {
  if (s.advanceNoticeMins !== undefined) { const n = Number(s.advanceNoticeMins); if (!Number.isFinite(n) || n < 0 || n > 7 * 24 * 60) return "advanceNoticeMins must be between 0 and 10080"; }
  for (const k of ["firstAppointment", "lastAppointment"] as const) { const v = s[k]; if (v && !TIME.test(String(v))) return k + " must be HH:MM (24-hour)"; }
  return null;
}
export async function getSpaRules(hotelId: string): Promise<SpaRules> {
  const rows = await prisma.$queryRawUnsafe<any[]>("select * from spa_rules where hotel_id = $1", hotelId);
  return rows[0] ? normSpa(rows[0]) : defaultSpaRules();
}
export async function setSpaRules(hotelId: string, s: SpaRulesInput, by?: string): Promise<SpaRules> {
  const cur = await getSpaRules(hotelId);
  const next = { ...cur, ...s };
  const rows = await prisma.$queryRawUnsafe<any[]>(
    "insert into spa_rules (hotel_id, advance_notice_mins, first_appointment, last_appointment, medical_to_human, cancellation, age_rule, notes, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (hotel_id) do update set advance_notice_mins = excluded.advance_notice_mins, first_appointment = excluded.first_appointment, last_appointment = excluded.last_appointment, medical_to_human = excluded.medical_to_human, cancellation = excluded.cancellation, age_rule = excluded.age_rule, notes = excluded.notes, updated_at = now(), updated_by = excluded.updated_by returning *",
    hotelId, Math.round(Number(next.advanceNoticeMins)), next.firstAppointment || null, next.lastAppointment || null, next.medicalToHuman !== false, clean(next.cancellation), clean(next.ageRule), clean(next.notes, 600), by || null);
  log.info("forms: spa rules saved", { hotelId, by: by || "?" });
  return normSpa(rows[0]);
}
const noticeText = (m: number): string => (m <= 0 ? "no" : m === 60 ? "1 hour's" : m % 60 === 0 ? m / 60 + " hours'" : m + " minutes'");
export function renderSpaRules(r: SpaRules): string {
  if (!r.set) return "";
  const lines: string[] = [];
  const window = r.firstAppointment || r.lastAppointment ? "; appointments " + (r.firstAppointment ? "from " + r.firstAppointment : "") + (r.lastAppointment ? (r.firstAppointment ? " to " : "until ") + r.lastAppointment : "") : "";
  lines.push("- Bookings need " + noticeText(r.advanceNoticeMins) + " notice" + window + ". Never confirm a time that breaks this - offer the next time that fits.");
  if (r.cancellation) lines.push("- Cancellation: " + r.cancellation);
  if (r.ageRule) lines.push("- Age: " + r.ageRule);
  if (r.notes) lines.push("- " + r.notes);
  if (r.medicalToHuman) lines.push("- If the guest mentions pregnancy, a medical condition, an injury, recent surgery, blood pressure or heart trouble, or medication: do NOT book or recommend a treatment. Say a therapist will call to check what is suitable, and file_request to spa with exactly what the guest said.");
  return "SPA RULES (the hotel's own):\n" + lines.join("\n");
}
/** Did the guest say something a therapist must hear before any booking - pregnancy, a condition, an injury, surgery, medication? */
export function spaNeedsHuman(text: string): boolean {
  const t = String(text ?? "");
  return /\b(pregnan\w*|expecting|trimester|medical|injur\w*|surgery|operation|fractur\w*|blood pressure|hypertension|heart (condition|problem|trouble|patient|surgery)|cardiac|diabet\w*|epilep\w*|asthma|allerg\w*|medication|medicines?|chemotherapy|cancer|slipped disc|sciatica|arthritis|thrombosis|varicose|rash|infection|fever|wound|stitches)\b/i.test(t)
    || /garbhvati|garbhavati|pregnant hoon|bimari|bimar hoon|chot lagi|operation hua|dawai/i.test(t);
}

/* ---------------------------------------------------------------- Form 5: services and prices ---- */

export type Service = { id: string; name: string; price: string | null; unit: string | null; hours: string | null; dept: string | null; how: string | null; active: boolean; sortOrder: number; updatedAt: string; updatedBy: string | null };
export type ServiceInput = Partial<Omit<Service, "id" | "updatedAt" | "updatedBy">>;
function normService(r: any): Service {
  return { id: String(r.id), name: String(r.name), price: r.price ?? null, unit: r.unit ?? null, hours: r.hours ?? null, dept: r.dept ?? null, how: r.how ?? null, active: r.active !== false, sortOrder: Number(r.sort_order ?? 0), updatedAt: iso(r.updated_at) ?? "", updatedBy: r.updated_by ?? null };
}
export async function listServices(hotelId: string): Promise<Service[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>("select * from hotel_services where hotel_id = $1 order by sort_order, name", hotelId);
  return rows.map(normService);
}
export async function addService(hotelId: string, s: ServiceInput, by?: string): Promise<Service> {
  const name = clean(s.name, 120);
  if (!name) throw new Error("name required");
  const rows = await prisma.$queryRawUnsafe<any[]>(
    "insert into hotel_services (hotel_id, name, price, unit, hours, dept, how, active, sort_order, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *",
    hotelId, name, clean(s.price, 80), clean(s.unit, 60), clean(s.hours, 120), clean(s.dept, 40), clean(s.how, 300), s.active !== false, Number(s.sortOrder ?? 0), by || null);
  return normService(rows[0]);
}
export async function updateService(hotelId: string, id: string, patch: ServiceInput, by?: string): Promise<Service | null> {
  const cur = await prisma.$queryRawUnsafe<any[]>("select * from hotel_services where hotel_id = $1 and id = $2::uuid", hotelId, id);
  if (!cur[0]) return null;
  const s = { ...normService(cur[0]), ...patch };
  const name = clean(s.name, 120);
  if (!name) throw new Error("name required");
  const rows = await prisma.$queryRawUnsafe<any[]>(
    "update hotel_services set name=$3, price=$4, unit=$5, hours=$6, dept=$7, how=$8, active=$9, sort_order=$10, updated_at=now(), updated_by=$11 where hotel_id=$1 and id=$2::uuid returning *",
    hotelId, id, name, clean(s.price, 80), clean(s.unit, 60), clean(s.hours, 120), clean(s.dept, 40), clean(s.how, 300), s.active !== false, Number(s.sortOrder ?? 0), by || null);
  return rows[0] ? normService(rows[0]) : null;
}
export async function deleteService(hotelId: string, id: string): Promise<boolean> {
  const n = await prisma.$executeRawUnsafe("delete from hotel_services where hotel_id = $1 and id = $2::uuid", hotelId, id);
  return Number(n) > 0;
}
export function renderServices(list: Service[]): string {
  const live = list.filter((s) => s.active);
  if (!live.length) return "";
  const line = (s: Service): string => "- " + s.name + ": " + [s.price ? s.price + (s.unit ? " " + s.unit : "") : "price on request", s.hours, s.how].filter(Boolean).join("; ") + (s.dept ? " (" + s.dept + ")" : "");
  return "SERVICES AND PRICES (the hotel's own list - quote these exactly; a service that is not here is not offered: say so and offer the front desk):\n" + live.map(line).join("\n");
}

/* ---------------------------------------------------------------- go-live ---- */

export type GoLive = { ready: boolean; filled: number; total: number; missing: { key: string; label: string }[]; counts: { facilities: number; facts: number; services: number; pairings: number }; spaRulesSet: boolean; live: boolean | null };

async function liveFlag(hotelId: string): Promise<boolean | null> {
  try { const r = await prisma.$queryRawUnsafe<any[]>('select onboarded from "Hotel" where "hotelId" = $1', hotelId); return r[0] ? r[0].onboarded === true : null; } catch { return null; }
}

/** What is filled, what is missing, and whether the hotel may go live. */
export async function goLiveCheck(hotelId: string): Promise<GoLive> {
  const p = await getProfile(hotelId);
  const missing = MANDATORY.filter((m) => !p[m.key]).map((m) => ({ key: String(m.key), label: m.label }));
  const count = async (sql: string): Promise<number> => { try { const r = await prisma.$queryRawUnsafe<any[]>(sql, hotelId); return Number(r[0]?.n ?? 0); } catch { return 0; } };
  const [facilities, facts, services, pairings, spa, live] = await Promise.all([
    count("select count(*)::int as n from facilities where hotel_id = $1 and active"),
    count("select count(*)::int as n from hotel_knowledge where hotel_id = $1 and active"),
    count("select count(*)::int as n from hotel_services where hotel_id = $1 and active"),
    count("select count(*)::int as n from menu_pairings where hotel_id = $1"),
    getSpaRules(hotelId).catch(() => defaultSpaRules()),
    liveFlag(hotelId),
  ]);
  return { ready: missing.length === 0, filled: MANDATORY.length - missing.length, total: MANDATORY.length, missing, counts: { facilities, facts, services, pairings }, spaRulesSet: spa.set, live };
}

/** Switch the hotel on - refused, with the list, while a mandatory field is empty. */
export async function goLive(hotelId: string, by?: string): Promise<{ ok: boolean; error?: string; check: GoLive }> {
  const check = await goLiveCheck(hotelId);
  if (!check.ready) return { ok: false, error: "Fill the mandatory fields first: " + check.missing.map((m) => m.label).join(", "), check };
  try { await prisma.$executeRawUnsafe('update "Hotel" set onboarded = true where "hotelId" = $1', hotelId); }
  catch (e) { const detail = e instanceof Error ? e.message : String(e); log.warn("go-live: the onboarded flag could not be set", { hotelId, detail }); return { ok: false, error: "the hotel could not be marked live: " + detail, check }; }
  log.info("go-live: hotel switched on", { hotelId, by: by || "?" });
  return { ok: true, check: { ...check, live: true } };
}

/** Forms 1, 4 and 5 as the brain reads them - empty when nothing is filled in. */
export async function formsForPrompt(hotelId: string): Promise<string> {
  try {
    const [p, spa, services, hotel] = await Promise.all([getProfile(hotelId), getSpaRules(hotelId), listServices(hotelId), prisma.hotel.findUnique({ where: { hotelId }, select: { name: true } }).catch(() => null)]);
    return [renderProfile(p, hotel?.name ?? null), renderSpaRules(spa), renderServices(services)].filter(Boolean).join("\n\n");
  } catch (e) { log.warn("forms: could not load", { hotelId, detail: e instanceof Error ? e.message : String(e) }); return ""; }
}
