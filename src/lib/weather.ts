import { prisma } from "../db";
import { log } from "./logger";

/**
 * Live weather outside each hotel, so Aria mentions heat or rain only when it is true - never a rainy
 * evening guessed from the calendar. Open-Meteo: the free host serves development; setting
 * OPEN_METEO_API_KEY switches to the commercial host a paying product needs.
 */
export type LocalWeather = { place: string; tempC: number; feelsC: number | null; humidity: number | null; condition: string; raining: boolean; rainChance: number | null; minC: number | null; maxC: number | null };

const KEY = process.env.OPEN_METEO_API_KEY ?? "";
const FORECAST = KEY ? "https://customer-api.open-meteo.com/v1/forecast" : "https://api.open-meteo.com/v1/forecast";
const GEOCODE = KEY ? "https://customer-geocoding-api.open-meteo.com/v1/search" : "https://geocoding-api.open-meteo.com/v1/search";
const withKey = (url: string) => (KEY ? url + "&apikey=" + encodeURIComponent(KEY) : url);

const FRESH_MS = 20 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; ttl: number; value: LocalWeather | null }>();
let columnsReady = false;

async function ensureColumns(): Promise<void> {
  if (columnsReady) return;
  await prisma.$executeRawUnsafe('alter table "Hotel" add column if not exists city text, add column if not exists latitude double precision, add column if not exists longitude double precision');
  columnsReady = true;
}

/** WMO weather codes, as Open-Meteo reports them, in words a host would use. */
export function conditionFor(code: number): { text: string; raining: boolean } {
  if (code === 0) return { text: "clear skies", raining: false };
  if (code === 1 || code === 2) return { text: "mostly clear", raining: false };
  if (code === 3) return { text: "overcast", raining: false };
  if (code === 45 || code === 48) return { text: "foggy", raining: false };
  if (code >= 51 && code <= 57) return { text: "light drizzle", raining: true };
  if (code >= 61 && code <= 67) return { text: code >= 65 ? "heavy rain" : "rain", raining: true };
  if (code >= 71 && code <= 77) return { text: "snow", raining: false };
  if (code >= 80 && code <= 82) return { text: "rain showers", raining: true };
  if (code === 85 || code === 86) return { text: "snow showers", raining: false };
  if (code >= 95) return { text: "thunderstorms", raining: true };
  return { text: "changeable weather", raining: false };
}

async function getJson(url: string, ms = 2500): Promise<any | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Where the hotel is: saved coordinates, or its town looked up once and remembered. */
async function locate(hotelId: string): Promise<{ lat: number; lon: number; place: string } | null> {
  await ensureColumns();
  const rows = await prisma.$queryRawUnsafe<any[]>('select city, latitude, longitude from "Hotel" where "hotelId" = $1', hotelId);
  const h = rows[0];
  if (!h || (!h.city && (h.latitude == null || h.longitude == null))) return null;
  const place = h.city ? String(h.city) : "the hotel";
  if (h.latitude != null && h.longitude != null) return { lat: Number(h.latitude), lon: Number(h.longitude), place };
  const g = await getJson(withKey(GEOCODE + "?count=1&language=en&format=json&name=" + encodeURIComponent(place)));
  const hit = g && g.results && g.results[0];
  if (!hit) { log.warn("weather: town not found", { hotelId, city: place }); return null; }
  await prisma.$executeRawUnsafe('update "Hotel" set latitude = $1, longitude = $2 where "hotelId" = $3', Number(hit.latitude), Number(hit.longitude), hotelId);
  return { lat: Number(hit.latitude), lon: Number(hit.longitude), place };
}

const whole = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? Math.round(v) : null);

/** The weather outside the hotel now, or null when unknown - and then nobody describes the weather. */
export async function localWeather(hotelId: string): Promise<LocalWeather | null> {
  const hit = cache.get(hotelId);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  let value: LocalWeather | null = null;
  try {
    const loc = await locate(hotelId);
    if (loc) {
      const w = await getJson(withKey(FORECAST + "?latitude=" + loc.lat + "&longitude=" + loc.lon + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto"));
      const cur = w && w.current;
      const temp = cur ? whole(cur.temperature_2m) : null;
      if (cur && temp != null) {
        const c = conditionFor(Number(cur.weather_code));
        const d = w.daily || {};
        value = { place: loc.place, tempC: temp, feelsC: whole(cur.apparent_temperature), humidity: whole(cur.relative_humidity_2m), condition: c.text, raining: c.raining, rainChance: whole(d.precipitation_probability_max && d.precipitation_probability_max[0]), minC: whole(d.temperature_2m_min && d.temperature_2m_min[0]), maxC: whole(d.temperature_2m_max && d.temperature_2m_max[0]) };
      }
    }
  } catch (err) {
    log.warn("weather: lookup failed", { hotelId, detail: err instanceof Error ? err.message : String(err) });
  }
  cache.set(hotelId, { at: Date.now(), ttl: value ? FRESH_MS : RETRY_MS, value });
  return value;
}

/** Real conditions for the brain, or a firm instruction not to describe the weather at all. */
export function weatherForPrompt(w: LocalWeather | null): string {
  if (!w) return "LOCAL WEATHER: not known right now. Do not describe the weather (no rainy evening, no sunny afternoon) unless the guest brings it up.";
  const deg = "\u00B0C";
  const parts: string[] = [w.condition, w.tempC + deg + (w.feelsC != null && Math.abs(w.feelsC - w.tempC) >= 3 ? " (feels like " + w.feelsC + deg + ")" : "")];
  if (w.humidity != null) parts.push(w.humidity + "% humidity");
  if (w.minC != null && w.maxC != null) parts.push("today " + w.minC + "-" + w.maxC + deg);
  if (w.rainChance != null) parts.push(w.rainChance + "% chance of rain today");
  return "LOCAL WEATHER in " + w.place + " right now (live - the only weather you may mention; the season above is background only): " + parts.join(", ") + ". Let it shape suggestions the way a good host would - heat and humidity suit cooling drinks and lighter plates, rain suits hot snacks and tea, a cool evening suits something warming - and mention it only when it helps. Never describe the weather differently from this line - but if the guest feels it differently (it is so hot), never correct them: acknowledge how it feels to them, say why if it helps (humidity makes it feel hotter), and help.";
}
