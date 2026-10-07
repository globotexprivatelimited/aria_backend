import { prisma } from "../db";
import { log } from "../lib/logger";

/**
 * Self-serve hotel setup: the founder pastes the phone-number id Meta shows for the hotel's number (and the WABA id
 * it sits in); this checks it with Meta, makes sure no other hotel owns it, saves it on the hotel row - after which
 * messages from that number route to the hotel and replies go out from it - and subscribes the app to the WABA so
 * its webhooks reach us. No script on the server, no SQL.
 */
const VERSION = process.env.META_API_VERSION ?? "v21.0";
const token = (): string => (process.env.META_ACCESS_TOKEN ?? "").trim();
const GRAPH = "https://graph.facebook.com/";

export type PhoneInfo = { phoneNumberId: string; number: string; verifiedName: string; quality: string; codeVerification: string; nameStatus: string; platform: string };
export type HotelWhatsApp = { hotelId: string; connected: boolean; phoneNumberId: string | null; wabaId: string | null; number: string | null; live: PhoneInfo | null; liveError: string | null; platformDefault: boolean };

async function graph(path: string, init?: RequestInit): Promise<{ ok: true; body: any } | { ok: false; error: string }> {
  if (!token()) return { ok: false, error: "META_ACCESS_TOKEN is not set on the server" };
  try {
    const res = await fetch(GRAPH + VERSION + path, { ...(init ?? {}), headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json", ...((init?.headers as Record<string, string>) ?? {}) } });
    const text = await res.text();
    let body: any = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 200) }; }
    if (!res.ok) return { ok: false, error: "Meta " + res.status + (body?.error?.code ? " (code " + body.error.code + ")" : "") + ": " + String(body?.error?.message ?? body?.raw ?? "request refused") };
    return { ok: true, body };
  } catch (e) { return { ok: false, error: "Meta unreachable: " + (e instanceof Error ? e.message : String(e)) }; }
}

/** What Meta says about a phone-number id - the proof it is real and ours to use. */
export async function inspectPhoneNumber(phoneNumberId: string): Promise<{ ok: true; info: PhoneInfo } | { ok: false; error: string }> {
  const id = String(phoneNumberId ?? "").replace(/\D/g, "");
  if (!id) return { ok: false, error: "phoneNumberId must be the numeric id Meta shows for the number" };
  const r = await graph("/" + id + "?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type");
  if (!r.ok) return r;
  const b = r.body;
  return { ok: true, info: { phoneNumberId: id, number: String(b.display_phone_number ?? ""), verifiedName: String(b.verified_name ?? ""), quality: String(b.quality_rating ?? "UNKNOWN"), codeVerification: String(b.code_verification_status ?? "UNKNOWN"), nameStatus: String(b.name_status ?? "UNKNOWN"), platform: String(b.platform_type ?? "") } };
}

/** Subscribe our app to the WABA so messages and statuses for its numbers reach the webhook. Idempotent on Meta's side. */
export async function subscribeWaba(wabaId: string): Promise<{ ok: boolean; error?: string }> {
  const id = String(wabaId ?? "").replace(/\D/g, "");
  if (!id) return { ok: false, error: "wabaId must be numeric" };
  const r = await graph("/" + id + "/subscribed_apps", { method: "POST" });
  return r.ok ? { ok: r.body?.success !== false } : { ok: false, error: r.error };
}

export async function hotelWhatsApp(hotelId: string, checkLive = true): Promise<HotelWhatsApp | null> {
  const rows = await prisma.$queryRawUnsafe<any[]>('select "hotelId", whatsapp_phone_id, whatsapp_waba_id, whatsapp_connected, "whatsappNumber" from "Hotel" where "hotelId" = $1', hotelId);
  if (!rows[0]) return null;
  const r = rows[0];
  const phoneNumberId = r.whatsapp_phone_id ? String(r.whatsapp_phone_id) : null;
  const out: HotelWhatsApp = { hotelId, connected: r.whatsapp_connected === true || !!phoneNumberId, phoneNumberId, wabaId: r.whatsapp_waba_id ? String(r.whatsapp_waba_id) : null, number: r.whatsappNumber ?? null, live: null, liveError: null, platformDefault: !phoneNumberId };
  if (checkLive && phoneNumberId) { const live = await inspectPhoneNumber(phoneNumberId); if (live.ok) out.live = live.info; else out.liveError = live.error; }
  return out;
}

export async function connectHotelWhatsApp(hotelId: string, phoneNumberId: string, wabaId?: string | null, by?: string): Promise<{ ok: true; data: HotelWhatsApp; subscribed: boolean | null; note: string } | { ok: false; error: string }> {
  const id = String(phoneNumberId ?? "").replace(/\D/g, "");
  const waba = String(wabaId ?? "").replace(/\D/g, "") || null;
  if (!id) return { ok: false, error: "phoneNumberId required - the numeric id under WhatsApp > API setup in Meta" };
  const exists = await prisma.$queryRawUnsafe<any[]>('select "hotelId" from "Hotel" where "hotelId" = $1', hotelId);
  if (!exists[0]) return { ok: false, error: "no hotel " + hotelId };
  const taken = await prisma.$queryRawUnsafe<any[]>('select "hotelId", name from "Hotel" where whatsapp_phone_id = $1 and "hotelId" <> $2', id, hotelId);
  if (taken[0]) return { ok: false, error: "that number is already linked to " + String(taken[0].name ?? taken[0].hotelId) + " - disconnect it there first" };
  const live = await inspectPhoneNumber(id);
  if (!live.ok) return { ok: false, error: "Meta does not recognise that phone-number id for our access token: " + live.error };
  await prisma.$executeRawUnsafe('update "Hotel" set whatsapp_phone_id = $2, whatsapp_waba_id = $3, whatsapp_connected = true, "whatsappNumber" = $4 where "hotelId" = $1', hotelId, id, waba, live.info.number || null);
  let subscribed: boolean | null = null; let note = "";
  if (waba) { const s = await subscribeWaba(waba); subscribed = s.ok; note = s.ok ? "App subscribed to WABA " + waba + " - inbound messages for this number will reach the webhook." : "Saved, but the app could not be subscribed to WABA " + waba + ": " + (s.error ?? "refused") + ". Until it is, inbound messages for this number will not arrive."; }
  else note = "Saved without a WABA id - if this number is in a different WhatsApp Business Account from the platform's, add the WABA id so the app can be subscribed to it.";
  log.info("hotel whatsapp linked", { hotelId, phoneNumberId: id, number: live.info.number, by: by || "?" });
  const data = await hotelWhatsApp(hotelId, false);
  return { ok: true, data: { ...(data as HotelWhatsApp), live: live.info }, subscribed, note };
}

export async function disconnectHotelWhatsApp(hotelId: string, by?: string): Promise<boolean> {
  const n = await prisma.$executeRawUnsafe('update "Hotel" set whatsapp_phone_id = null, whatsapp_waba_id = null, whatsapp_connected = false where "hotelId" = $1', hotelId);
  log.info("hotel whatsapp unlinked - back to the platform default number", { hotelId, by: by || "?" });
  return Number(n) > 0;
}

/** The hotel a phone-number id belongs to, for routing an inbound message; null when no hotel owns it. */
export async function hotelIdForPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const id = String(phoneNumberId ?? "").replace(/\D/g, "");
  if (!id) return null;
  try { const r = await prisma.$queryRawUnsafe<any[]>('select "hotelId" from "Hotel" where whatsapp_phone_id = $1', id); return r[0] ? String(r[0].hotelId) : null; } catch { return null; }
}
