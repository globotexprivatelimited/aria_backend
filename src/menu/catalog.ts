import { prisma } from "../db";
import { log } from "../lib/logger";
import { recordMissedDemand } from "../misseddemand/service";
import type { BrainOutput, BrainRequest } from "../brain/schema";

/**
 * The hotel's live catalog - in-room dining menu, restaurant menu and spa services -
 * and the rules that stop Aria from selling anything that is not on it.
 *
 * Two halves:
 *   loadCatalog()  - reads menu_items + dept_items, gives the brain a compact menu with short codes.
 *   applyCatalog() - after the brain has answered, checks every item it named against the database,
 *                    places a real order for what is available, and composes the order summary itself
 *                    so prices in the guest's reply always come from the database, never from the model.
 */

const RUPEE = "\u20B9";
const MAX_SUGGESTIONS = 3;
const STRONG_MATCH = 0.78;   // a "not on menu" ask that actually is on the menu, just spelt differently
const WEAK_MATCH = 0.3;      // below this a suggestion is filler, not a real match
const MAX_LIST = 8;          // items shown when the guest browses a category
const DIGEST_LIMIT = 30;     // above this, the full menu is offered by category instead of in one go

export type CatalogDept = "fb" | "dining" | "spa";

export type CatalogItem = {
  id: string;
  code: string;
  dept: CatalogDept;
  name: string;
  category: string | null;
  kind: string | null;
  diet: string | null;
  price: number;
  stock: number;          // 0 means not tracked
  available: boolean;
  prepMins: number;
  durationMin: number;
  signature: boolean;
  bestseller: boolean;
  ageRestricted: boolean;
  servedFrom: string | null;
  servedTo: string | null;
};

export type Catalog = {
  items: CatalogItem[];
  byCode: Map<string, CatalogItem>;
  promptText: string;
  configured: Record<CatalogDept, boolean>;
  timezone: string | null;
  now: Date;
};

/* ---------------------------------------------------------------- loading ---------- */

function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function hhmm(v: unknown): string | null {
  const s = str(v);
  return s ? s.slice(0, 5) : null;
}

export async function loadCatalog(hotelId: string, timezone: string | null): Promise<Catalog> {
  const items: CatalogItem[] = [];
  const counters: Record<CatalogDept, number> = { fb: 0, dining: 0, spa: 0 };
  const prefix: Record<CatalogDept, string> = { fb: "F", dining: "D", spa: "S" };
  const nextCode = (dept: CatalogDept) => prefix[dept] + String(++counters[dept]);

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select id, dept, name, category, kind, diet, price, stock, available, prep_mins, is_signature, is_bestseller, age_restricted, available_from, available_to
         from menu_items where hotel_id = $1 and dept in ('fb', 'dining')
        order by dept, category asc nulls last, sort_order asc, name asc`, hotelId);
    for (const r of rows) {
      const dept = (r.dept === "dining" ? "dining" : "fb") as CatalogDept;
      items.push({
        id: String(r.id), code: nextCode(dept), dept, name: String(r.name).trim(), category: str(r.category), kind: str(r.kind),
        diet: str(r.diet), price: num(r.price), stock: num(r.stock), available: r.available !== false,
        prepMins: num(r.prep_mins), durationMin: 0, signature: !!r.is_signature, bestseller: !!r.is_bestseller,
        ageRestricted: !!r.age_restricted, servedFrom: hhmm(r.available_from), servedTo: hhmm(r.available_to),
      });
    }
  } catch (e) {
    log.warn("catalog: menu_items unavailable", { detail: e instanceof Error ? e.message : String(e) });
  }

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select id, name, category, kind, price, stock, available, duration_min, is_signature, time_from, time_to
         from dept_items where hotel_id = $1 and dept = 'spa'
        order by sort_order asc, name asc`, hotelId);
    for (const r of rows) {
      items.push({
        id: String(r.id), code: nextCode("spa"), dept: "spa", name: String(r.name).trim(), category: str(r.category), kind: str(r.kind),
        diet: null, price: num(r.price), stock: num(r.stock), available: r.available !== false,
        prepMins: 0, durationMin: num(r.duration_min), signature: !!r.is_signature, bestseller: false,
        ageRestricted: false, servedFrom: hhmm(r.time_from), servedTo: hhmm(r.time_to),
      });
    }
  } catch (e) {
    log.warn("catalog: dept_items unavailable", { detail: e instanceof Error ? e.message : String(e) });
  }

  const byCode = new Map(items.map((i) => [i.code, i]));
  const configured: Record<CatalogDept, boolean> = {
    fb: items.some((i) => i.dept === "fb"),
    dining: items.some((i) => i.dept === "dining"),
    spa: items.some((i) => i.dept === "spa"),
  };
  const now = new Date();
  return { items, byCode, promptText: renderForPrompt(items, timezone, now), configured, timezone, now };
}

/* ---------------------------------------------------------------- availability ------ */

function nowHHMM(tz: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz ?? undefined }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-GB", opts).format(new Date());
  }
}

function servingNow(item: CatalogItem, tz: string | null): boolean {
  if (!item.servedFrom || !item.servedTo) return true;
  const now = nowHHMM(tz);
  const f = item.servedFrom, t = item.servedTo;
  return f <= t ? now >= f && now <= t : now >= f || now <= t;
}

type Availability = { ok: true } | { ok: false; reason: "sold_out" | "not_served_now" };

function availability(item: CatalogItem, tz: string | null): Availability {
  if (!item.available) return { ok: false, reason: "sold_out" };
  if (!servingNow(item, tz)) return { ok: false, reason: "not_served_now" };
  return { ok: true };
}

/* ---------------------------------------------------------------- prompt ----------- */

function money(n: number): string {
  const v = Math.round(n * 100) / 100;
  return RUPEE + (Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toFixed(2));
}

function to12h(hhmmStr: string): string {
  const [h, m] = hhmmStr.split(":").map((x) => Number(x));
  if (!Number.isFinite(h)) return hhmmStr;
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return hour + (m ? ":" + String(m).padStart(2, "0") : "") + " " + suffix;
}

function renderForPrompt(items: CatalogItem[], tz: string | null, now: Date): string {
  if (items.length === 0) return "";
  const sections: string[] = [describeMoment(momentOf(tz, now))];
  const block = (dept: CatalogDept, title: string, header: string) => {
    const rows = items.filter((i) => i.dept === dept);
    if (rows.length === 0) return;
    const lines = rows.map((i) => {
      const notes: string[] = [];
      const a = availability(i, tz);
      if (!a.ok && a.reason === "sold_out") notes.push("SOLD OUT");
      if (!a.ok && a.reason === "not_served_now") notes.push("NOT SERVED NOW (" + to12h(i.servedFrom!) + " to " + to12h(i.servedTo!) + ")");
      if (i.bestseller) notes.push("bestseller");
      if (i.signature) notes.push("signature");
      if (i.ageRestricted) notes.push("21+ only");
      if (dept === "spa" && i.durationMin) notes.push(i.durationMin + " min");
      if (dept !== "spa" && i.prepMins) notes.push(i.prepMins + " min");
      return [i.code, i.name, i.category ?? "-", i.diet ?? "-", money(i.price), notes.join(", ") || "-"].join(" | ");
    });
    sections.push(title + " (" + header + ")\n" + lines.join("\n"));
  };
  block("fb", "IN-ROOM DINING MENU", "code | name | category | diet | price | notes");
  block("dining", "RESTAURANT MENU - served in the restaurant, not to rooms", "code | name | category | diet | price | notes");
  block("spa", "SPA SERVICES", "code | name | category | - | price | notes");
  return sections.join("\n\n");
}

/* ---------------------------------------------------------------- matching --------- */

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  const t = s.replace(/\s/g, "");
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
/** 0..1 similarity between what the guest typed and a catalog name: Dice on bigrams blended with token overlap. */
function similarity(ask: string, name: string): number {
  const a = normalise(ask), b = normalise(name);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9;
  const ba = bigrams(a), bb = bigrams(b);
  let common = 0;
  for (const g of ba) if (bb.has(g)) common++;
  const dice = (2 * common) / (ba.size + bb.size || 1);
  const ta = new Set(a.split(" ")), tb = new Set(b.split(" "));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const jaccard = shared / (new Set([...ta, ...tb]).size || 1);
  return Math.max(dice, jaccard);
}

const NONVEG = ["mutton", "lamb", "goat", "chicken", "murgh", "fish", "prawn", "prawns", "shrimp", "crab", "egg", "eggs", "keema", "beef", "pork", "bacon", "ham", "tandoori", "kebab", "kabab", "seekh", "biryani"];
const VEG = ["paneer", "veg", "vegetable", "dal", "daal", "aloo", "gobi", "bhindi", "mushroom", "tofu", "chana", "rajma", "palak", "salad"];

function inferDiet(ask: string): "nonveg" | "veg" | null {
  const a = " " + normalise(ask) + " ";
  if (NONVEG.some((w) => a.includes(" " + w + " "))) return "nonveg";
  if (VEG.some((w) => a.includes(" " + w + " "))) return "veg";
  return null;
}
function dietMatches(pref: "nonveg" | "veg" | null, item: CatalogItem): boolean {
  if (!pref || !item.diet) return false;
  const d = item.diet.toLowerCase();
  return pref === "nonveg" ? d.includes("non") || d === "egg" : !d.includes("non") && d !== "egg";
}

function bestMatch(ask: string, candidates: CatalogItem[]): { item: CatalogItem; score: number } | null {
  let best: { item: CatalogItem; score: number } | null = null;
  for (const item of candidates) {
    const score = similarity(ask, item.name);
    if (!best || score > best.score) best = { item, score };
  }
  return best;
}

const DRINK = ["chai", "tea", "coffee", "espresso", "latte", "cappuccino", "juice", "water", "soda", "lassi", "milk", "cola", "coke", "pepsi", "sprite", "beer", "wine", "whisky", "whiskey", "cocktail", "mocktail", "shake", "smoothie", "drink", "drinks", "beverage", "beverages", "soft"];
const CATEGORY_HINTS: { words: string[]; category: RegExp }[] = [
  { words: ["starter", "starters", "snack", "snacks", "appetizer", "appetiser", "bite", "bites", "nibbles"], category: /start|snack|appet|small/i },
  { words: ["dessert", "desserts", "sweet", "sweets", "ice cream", "icecream", "cake", "pudding", "halwa", "kheer", "gulab", "jamun", "rasgulla", "rasmalai", "kulfi", "brownie", "pastry", "mithai", "phirni", "jalebi"], category: /dessert|sweet|cake|ice/i },
  { words: ["main", "mains", "main course", "curry", "dinner", "lunch", "meal", "thali"], category: /main|curr|meal|dinner|lunch|thali/i },
  { words: ["breakfast", "morning"], category: /breakfast/i },
  { words: ["soup", "soups"], category: /soup/i },
  { words: ["bread", "roti", "naan", "rice", "biryani", "pulao"], category: /bread|rice|biryan/i },
];
const ANCHOR_MATCH = 0.3;   // an existing item close enough in name to shape the suggestions
const FILLER = ["some", "something", "anything", "a", "an", "any", "the", "please", "pls", "i", "we", "want", "need", "would", "like", "get", "give", "me", "us", "one", "two", "of", "for", "to", "have", "you", "do", "can", "kind", "type", "which", "what"];
const GENERIC = ["drink", "drinks", "beverage", "beverages", "soft", "cold", "hot", "food", "eat", "eating", "hungry", "menu", "options", "veg", "vegetarian", "nonveg", "non", "sweet", "sweets", "snack", "snacks", "starter", "starters", "dessert", "desserts", "main", "mains", "breakfast", "lunch", "dinner", "meal", "soup", "soups", "bread", "rice", "curry", "appetizer", "appetiser", "bite", "bites", "nibbles", "thali"];

/** "some snacks", "soft drink", "veg food" name a category, not a dish - they get a list, not an apology. */
function isGenericAsk(ask: string): boolean {
  const words = normalise(ask).split(" ").filter((w) => w && !FILLER.includes(w));
  return words.length > 0 && words.every((w) => GENERIC.includes(w));
}
const LABELS: Record<string, string> = {
  eat: "food", eating: "food", hungry: "food", menu: "food", options: "food", sweet: "desserts", sweets: "desserts", dessert: "desserts",
  snack: "snacks", starter: "starters", appetizer: "starters", appetiser: "starters", bite: "snacks", bites: "snacks", nibbles: "snacks",
  drink: "drinks", beverage: "drinks", beverages: "drinks", main: "mains", soup: "soups", cold: "cold drinks", hot: "hot drinks",
};
/** The category the guest named, in the words a menu would use: "some snacks" -> snacks, "something to eat" -> food. */
function askLabel(ask: string): string {
  const words = normalise(ask).split(" ").filter((w) => w && !FILLER.includes(w)).map((w) => LABELS[w] ?? w);
  if (words.length === 0 || words.length > 3) return "that";
  if (words.length === 2 && words[0] === "soft" && words[1] === "drinks") return "soft drinks";
  return Array.from(new Set(words)).join(" ");
}

function kindOf(item: CatalogItem): "drink" | "food" {
  if (item.kind === "drink" || item.kind === "alcohol") return "drink";
  // GMs often leave the type on the default "food" - the category or the name usually gives it away
  if (item.category && /bever|drink|tea|coffee|juice|bar\b|mocktail|cocktail|shake|smoothie|lassi/i.test(item.category)) return "drink";
  const n = " " + normalise(item.name) + " ";
  return DRINK.some((w) => w !== "soft" && n.includes(" " + w + " ")) ? "drink" : "food";
}
/** What the words say the guest wants: a drink, a dish, or no hint at all. */
function inferKindFromWords(ask: string): "drink" | "food" | null {
  const a = " " + normalise(ask) + " ";
  if (DRINK.some((w) => a.includes(" " + w + " "))) return "drink";
  if (inferDiet(ask) || inferCategory(ask)) return "food";
  return null;
}
function inferCategory(ask: string): RegExp | null {
  const a = " " + normalise(ask) + " ";
  for (const h of CATEGORY_HINTS) if (h.words.some((w) => a.includes(" " + w + " "))) return h.category;
  return null;
}
/** The category word the guest used, pluralised the way a menu would: "chicken soup" -> soups. */
function categoryLabel(ask: string): string | null {
  const a = " " + normalise(ask) + " ";
  for (const h of CATEGORY_HINTS) for (const w of h.words) if (a.includes(" " + w + " ")) return LABELS[w] ?? (w.endsWith("s") ? w : w + "s");
  return null;
}

/**
 * Up to three alternatives for something we cannot serve - and only things that are actually
 * alternatives. A drink ask is answered with drinks, a dish with dishes; real matches (similar
 * name or same category) come first, then the house favourites of the right diet. Nothing is
 * padded in just to make three: if the hotel has nothing comparable, the list is empty and the
 * guest is told so, rather than being offered paneer for a coffee.
 */
function suggest(ask: string, dept: CatalogDept, catalog: Catalog, exclude: Set<string>, anchorIn: CatalogItem | null): CatalogItem[] {
  const pref = inferDiet(ask);
  const generic = dept !== "spa" && isGenericAsk(ask);
  const wordKind = dept === "spa" ? null : inferKindFromWords(ask);
  const kind = dept === "spa" ? null : wordKind ?? (anchorIn ? kindOf(anchorIn) : "food");
  // an anchor that disagrees with the words is a coincidence of spelling, not a clue
  const anchor = anchorIn && (dept === "spa" || kindOf(anchorIn) === kind) ? anchorIn : null;
  const category = inferCategory(ask);
  const basePool = catalog.items.filter((i) => i.dept === dept && !exclude.has(i.id) && availability(i, catalog.timezone).ok && (!kind || kindOf(i) === kind) && (!generic || !pref || dietMatches(pref, i)));
  let pool = category ? basePool.filter((i) => i.category != null && category.test(i.category)) : basePool;
  // nothing in the category they named: offer what matches their diet instead, and say so
  const categoryFallback = !!category && pool.length === 0;
  if (categoryFallback) pool = basePool;
  const scored = pool.map((item) => {
    const sim = similarity(ask, item.name);
    let score = sim;
    const sameCategory = !!(anchor && anchor.category && item.category === anchor.category);
    const askedCategory = !!(category && item.category && category.test(item.category));
    if (sameCategory) score += 0.15;
    if (askedCategory) score += 0.3;
    if (anchor && anchor.diet && item.diet === anchor.diet) score += 0.1;
    if (dietMatches(pref, item)) score += 0.2;
    if (item.bestseller) score += 0.05;
    if (item.signature) score += 0.05;
    return { item, score, real: sim >= WEAK_MATCH || sameCategory || askedCategory };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked: CatalogItem[] = [];
  const cap = generic && category ? MAX_LIST : MAX_SUGGESTIONS;
  const take = (list: typeof scored) => {
    for (const s of list) {
      if (picked.length >= cap) break;
      if (!picked.some((p) => p.id === s.item.id)) picked.push(s.item);
    }
  };
  // an empty category: only things linked by diet are worth offering ("chicken soup" -> the chicken dishes)
  if (categoryFallback) { if (pref) take(scored.filter((s) => dietMatches(pref, s.item))); return picked; }
  // a category ask lists what there is in that category; a dish ask gets real lookalikes first
  if (generic || category) { take(scored); return picked; }
  take(scored.filter((s) => s.real));
  if (pref) take(scored.filter((s) => (s.item.bestseller || s.item.signature) && dietMatches(pref, s.item)));
  // a drink ask with no similar drink: offer what drinks there are, since that is what they want
  if (kind === "drink" || dept === "spa") take(scored);
  return picked;
}

/* ---------------------------------------------------------------- moment ----------- */

export type DayPart = "morning" | "afternoon" | "evening" | "night" | "late";
export type Season = "hot" | "cold" | "rainy" | "mild";
export type Moment = { dayPart: DayPart; season: Season; hour: number; weekday: string };

/** Hotel-local hour, month and weekday - what the guest is experiencing, not what the server clock says. */
export function momentOf(tz: string | null, now: Date = new Date()): Moment {
  let hour = now.getUTCHours(), month = now.getUTCMonth() + 1, weekday = "day";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", month: "numeric", weekday: "long", hourCycle: "h23", timeZone: tz ?? undefined }).formatToParts(now);
    for (const p of parts) {
      if (p.type === "hour") hour = Number(p.value);
      if (p.type === "month") month = Number(p.value);
      if (p.type === "weekday") weekday = p.value;
    }
  } catch { /* server clock it is */ }
  const dayPart: DayPart = hour < 5 ? "late" : hour < 11 ? "morning" : hour < 16 ? "afternoon" : hour < 20 ? "evening" : "night";
  return { dayPart, season: seasonOf(tz, month), hour, weekday };
}

/** Rough season from the calendar; India gets its own summer / monsoon / winter split, elsewhere the hemisphere decides. */
function seasonOf(tz: string | null, month: number): Season {
  const z = (tz ?? "").toLowerCase();
  if (z.includes("kolkata") || z.includes("calcutta") || z.includes("dhaka") || z.includes("karachi") || z.includes("kathmandu") || z.includes("colombo")) {
    if (month >= 3 && month <= 6) return "hot";
    if (month >= 7 && month <= 9) return "rainy";
    if (month === 12 || month <= 2) return "cold";
    return "mild";
  }
  const southern = /australia|sydney|melbourne|auckland|johannesburg|sao_paulo|buenos_aires|santiago|lima|nairobi/.test(z);
  const hotMonths = southern ? [12, 1, 2] : [6, 7, 8];
  const coldMonths = southern ? [6, 7, 8] : [12, 1, 2];
  if (hotMonths.includes(month)) return "hot";
  if (coldMonths.includes(month)) return "cold";
  return "mild";
}

function describeMoment(m: Moment): string {
  const seasonText = m.season === "hot" ? "hot season" : m.season === "cold" ? "cold season" : m.season === "rainy" ? "monsoon, rainy" : "mild weather";
  return "NOW AT THE HOTEL: " + m.weekday + " " + m.dayPart + " (" + String(m.hour).padStart(2, "0") + ":00 local), " + seasonText + ". Let this shape what you suggest - cool things in the heat, warm things in the cold, breakfast in the morning.";
}

const COOL_WORDS = ["cold", "iced", "ice", "chilled", "lemon", "lemonade", "lime", "nimbu", "shikanji", "lassi", "juice", "shake", "milkshake", "mocktail", "soda", "cola", "smoothie", "kulfi", "cream", "sorbet", "salad", "raita", "buttermilk", "chaas", "chaach", "coconut", "watermelon", "mojito", "cooler", "sherbet", "sharbat", "frappe"];
const WARM_WORDS = ["hot", "soup", "chai", "tea", "coffee", "kadha", "kaadha", "warm", "halwa", "stew", "cocoa", "chocolate", "kheer", "broth", "pakora", "pakoda", "bhaji", "bhajiya", "samosa", "fritter", "maggi", "toast", "latte", "cappuccino", "espresso", "kahwa", "kesar"];
const RAINY_WORDS = ["pakora", "pakoda", "bhaji", "bhajiya", "samosa", "fritter", "chai", "tea", "maggi", "soup", "corn", "vada", "kachori", "coffee"];
const BREAKFAST_WORDS = ["omelette", "omelet", "egg", "eggs", "paratha", "poha", "upma", "idli", "dosa", "toast", "pancake", "pancakes", "cereal", "muesli", "porridge", "juice", "coffee", "tea", "chai", "croissant", "sandwich", "waffle", "uttapam", "chole", "bhature", "puri", "aloo"];
const DESSERT_WORDS = ["gulab", "jamun", "kheer", "halwa", "cream", "kulfi", "brownie", "cake", "pastry", "rasgulla", "rasmalai", "sandesh", "mousse", "pudding", "tart", "phirni", "jalebi", "malpua", "sundae"];

function hasWord(item: CatalogItem, words: string[]): boolean {
  const text = " " + normalise(item.name + " " + (item.category ?? "")) + " ";
  return words.some((w) => text.includes(" " + w + " "));
}
function isDessert(item: CatalogItem): boolean {
  return !!(item.category && /dessert|sweet/i.test(item.category)) || hasWord(item, DESSERT_WORDS);
}
function isBreakfast(item: CatalogItem): boolean {
  return !!(item.category && /breakfast/i.test(item.category)) || hasWord(item, BREAKFAST_WORDS);
}

export type Pick = { item: CatalogItem; score: number; reason: string };

/** How well an item suits this moment, with the reason a concierge would give for it. */
function affinity(item: CatalogItem, m: Moment, history: Map<string, number>): Pick {
  const reasons: { score: number; text: string }[] = [];
  const cool = hasWord(item, COOL_WORDS), warm = hasWord(item, WARM_WORDS), rainy = hasWord(item, RAINY_WORDS);
  const drink = kindOf(item) === "drink";
  const hits = history.get(item.id) ?? 0;

  if (m.season === "hot" && cool) reasons.push({ score: 3, text: m.dayPart === "afternoon" ? "perfect for this afternoon heat" : "perfect for this heat" });
  if (m.season === "hot" && warm && !(drink && m.dayPart === "morning")) reasons.push({ score: -1.5, text: "" });
  if (m.season === "cold" && warm) reasons.push({ score: 3, text: m.dayPart === "night" || m.dayPart === "evening" ? "just right for a cold evening" : "warming on a cold day" });
  if (m.season === "cold" && cool) reasons.push({ score: -1.5, text: "" });
  if (m.season === "rainy" && rainy) reasons.push({ score: 2.5, text: "made for a rainy day" });
  if (m.dayPart === "morning" && isBreakfast(item)) reasons.push({ score: 2.5, text: "a good way to start the morning" });
  if (m.dayPart !== "morning" && isBreakfast(item) && !drink) reasons.push({ score: -1, text: "" });
  if ((m.dayPart === "night" || m.dayPart === "evening") && isDessert(item)) reasons.push({ score: 2, text: "a sweet finish to the evening" });
  if (m.dayPart === "late" && (item.category && /snack|start|light|soup/i.test(item.category))) reasons.push({ score: 1.5, text: "something light for a late night" });
  if (hits > 0) reasons.push({ score: 2 + Math.min(hits, 3) * 0.5, text: hits > 1 ? "your usual" : "you enjoyed this before" });
  if (item.bestseller) reasons.push({ score: 1, text: "our bestseller" });
  if (item.signature) reasons.push({ score: 1, text: "the chef's signature" });

  const score = reasons.reduce((s, r) => s + r.score, 0);
  const strong = reasons.filter((r) => r.text && r.score >= 2).sort((a, b) => b.score - a.score);
  const reason = strong.length >= 2 ? strong[0].text + ", and " + strong[1].text : strong[0]?.text ?? reasons.filter((r) => r.text).sort((a, b) => b.score - a.score)[0]?.text ?? "";
  return { item, score, reason };
}

/** The best things to put in front of this guest right now, from the available menu. */
export function picksFor(catalog: Catalog, dept: CatalogDept, history: Map<string, number>, opts: { exclude?: Set<string>; kind?: "drink" | "food" | null; limit?: number; minScore?: number } = {}): Pick[] {
  const m = momentOf(catalog.timezone, catalog.now);
  const pool = catalog.items.filter((i) => i.dept === dept && availability(i, catalog.timezone).ok && !(opts.exclude?.has(i.id)) && (!opts.kind || kindOf(i) === opts.kind));
  return pool.map((i) => affinity(i, m, history))
    .filter((p) => p.reason && p.score >= (opts.minScore ?? 1.5))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 2);
}

/** What this guest has ordered here before: item id -> times. */
export async function loadGuestHistory(hotelId: string, guestPhone: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select oi.menu_item_id as id, count(*)::int as n from order_items oi join orders o on o.id = oi.order_id
        where o.hotel_id = $1 and o.guest_phone = $2 and oi.menu_item_id is not null and o.status <> 'cancelled' group by oi.menu_item_id`, hotelId, guestPhone);
    for (const r of rows) if (r.id) map.set(String(r.id), num(r.n));
  } catch { /* no history is fine */ }
  return map;
}

function pickLine(p: Pick, dept: CatalogDept): string {
  return itemLabel(p.item, dept) + (p.reason ? " - " + p.reason : "");
}

/* ---------------------------------------------------------------- browsing --------- */

const MENU_WORDS = ["menu", "have", "having", "offer", "offering", "available", "availability", "options", "option", "there", "what", "whats", "s", "all", "show", "list", "see", "tell", "dikhao", "hai", "kya", "kuch", "everything", "serve", "serving", "sell", "got", "food", "eat", "items", "dishes", "choices", "today", "tonight", "now", "on", "in", "is", "are", "u", "ur", "r", "your", "ya", "hey", "hi", "hello", "aria", "room", "service", "dining", "card"];
const MENU_SIGNAL = ["menu", "have", "having", "offer", "offering", "available", "availability", "options", "option", "dikhao", "hai", "serve", "serving", "got", "list", "show", "choices", "items", "dishes", "card"];
const SPA_WORDS = ["spa", "massage", "treatment", "treatments", "facial", "therapy", "wellness", "salon"];

/** "what do you have?", "menu please", "kya kya hai" - a request to see the menu, with no dish or category named. */
export function isMenuQuestion(message: string): boolean {
  const raw = normalise(message).split(" ").filter(Boolean);
  if (raw.length === 0) return false;
  const signal = raw.some((w) => MENU_SIGNAL.includes(w));
  const rest = raw.filter((w) => !FILLER.includes(w) && !MENU_WORDS.includes(w) && !SPA_WORDS.includes(w));
  return signal && rest.length === 0;
}
export function menuDeptFor(message: string, catalog: Catalog): CatalogDept | null {
  const a = " " + normalise(message) + " ";
  if (SPA_WORDS.some((w) => a.includes(" " + w + " "))) return catalog.configured.spa ? "spa" : null;
  return catalog.configured.fb ? "fb" : catalog.configured.spa ? "spa" : null;
}

function categoriesOf(catalog: Catalog, dept: CatalogDept): string[] {
  const seen: string[] = [];
  for (const i of catalog.items) if (i.dept === dept && i.category && !seen.includes(i.category)) seen.push(i.category);
  return seen;
}

/** A guest naming one of the hotel's own categories ("tandoor", "beverages") wants to see it, not to be told it is not a dish. */
function browseCategory(ask: string, dept: CatalogDept, catalog: Catalog): { label: string; items: CatalogItem[] } | null {
  let best: { label: string; score: number } | null = null;
  for (const c of categoriesOf(catalog, dept)) {
    const s = similarity(ask, c);
    if (!best || s > best.score) best = { label: c, score: s };
  }
  if (!best || best.score < 0.6) return null;
  const items = catalog.items.filter((i) => i.dept === dept && i.category === best!.label && availability(i, catalog.timezone).ok).slice(0, MAX_LIST);
  return { label: best.label, items };
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

/** The next step after a dead end: what the hotel does have, as a question the guest can answer in a word. */
function guideText(catalog: Catalog, dept: CatalogDept): string {
  const cats = categoriesOf(catalog, dept);
  if (dept === "spa") return "Would you like to see our spa services instead? Just say spa menu.";
  if (cats.length === 0) return "Would you like something else? Just ask for the menu and I will send it over.";
  return "Would you like something else? We have " + joinNatural(cats.slice(0, 6)) + " - just say which, or ask for the full menu.";
}

/** The menu itself, composed by the server: grouped by category with prices, or by category headings when it is long. */
export function menuDigest(catalog: Catalog, dept: CatalogDept, history: Map<string, number> = new Map()): string {
  const items = catalog.items.filter((i) => i.dept === dept && availability(i, catalog.timezone).ok);
  if (items.length === 0) return dept === "spa" ? "Our spa list is not published yet - the team can tell you what is on today." : "Our in-room menu is not published yet - the team can tell you what is on today.";
  const cats = categoriesOf(catalog, dept);
  const title = dept === "spa" ? "Our spa services:" : dept === "dining" ? "Our restaurant menu:" : "Our in-room dining menu:";
  if (items.length > DIGEST_LIMIT && cats.length > 1) {
    const heads = cats.map((c) => c + " (" + items.filter((i) => i.category === c).length + ")");
    return title + " " + joinNatural(heads) + ". Which would you like to see?";
  }
  const lines: string[] = [title];
  const picks = dept === "spa" ? [] : picksFor(catalog, dept, history, { limit: 2, minScore: 2 });
  if (picks.length) lines.push("Right now we would suggest: " + picks.map((p) => pickLine(p, dept)).join("; ") + ".");
  const line = (list: CatalogItem[]) => list.map((i) => itemLabel(i, dept)).join(", ");
  for (const c of cats) {
    const list = items.filter((i) => i.category === c);
    if (list.length) lines.push(c + ": " + line(list));
  }
  const uncategorised = items.filter((i) => !i.category);
  if (uncategorised.length) lines.push((cats.length ? "Also: " : "") + line(uncategorised));
  lines.push(dept === "spa" ? "Tell me which treatment and a time that suits you." : "Just tell me what you would like, and how many.");
  return lines.join("\n");
}

/* ---------------------------------------------------------------- memory ----------- */

/** What Aria is waiting on from this guest - the options just offered, and for what. */
export type GuestContext = {
  kind: "choose";
  dept: CatalogDept;
  ask: string;
  qty: number;
  options: { code: string; name: string; price: number }[];
};

export type BrainTurn = { role: "user" | "assistant"; content: string };

const CONTEXT_TTL_MINUTES = 45;
let contextTableReady = false;

async function ensureContextTable(): Promise<void> {
  if (contextTableReady) return;
  try {
    await prisma.$executeRawUnsafe(
      `create table if not exists guest_context (
         hotel_id text not null, guest_phone text not null, kind text not null, data jsonb not null default '{}'::jsonb,
         expires_at timestamptz not null, updated_at timestamptz not null default now(),
         primary key (hotel_id, guest_phone))`);
    contextTableReady = true;
  } catch (e) {
    log.warn("catalog: guest_context table unavailable", { detail: e instanceof Error ? e.message : String(e) });
  }
}

export async function loadGuestContext(hotelId: string, guestPhone: string): Promise<GuestContext | null> {
  await ensureContextTable();
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select kind, data from guest_context where hotel_id = $1 and guest_phone = $2 and expires_at > now()`, hotelId, guestPhone);
    const r = rows[0];
    if (!r || r.kind !== "choose") return null;
    const data = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    return data && Array.isArray(data.options) ? { kind: "choose", ...data } as GuestContext : null;
  } catch { return null; }
}

async function saveGuestContext(hotelId: string, guestPhone: string, ctx: GuestContext): Promise<void> {
  await ensureContextTable();
  try {
    const { kind, ...data } = ctx;
    await prisma.$executeRawUnsafe(
      `insert into guest_context (hotel_id, guest_phone, kind, data, expires_at)
       values ($1, $2, $3, $4::jsonb, now() + ($5 || ' minutes')::interval)
       on conflict (hotel_id, guest_phone) do update set kind = excluded.kind, data = excluded.data, expires_at = excluded.expires_at, updated_at = now()`,
      hotelId, guestPhone, kind, JSON.stringify(data), String(CONTEXT_TTL_MINUTES));
  } catch (e) {
    log.warn("catalog: could not save guest context", { detail: e instanceof Error ? e.message : String(e) });
  }
}

async function clearGuestContext(hotelId: string, guestPhone: string): Promise<void> {
  await ensureContextTable();
  try { await prisma.$executeRawUnsafe(`delete from guest_context where hotel_id = $1 and guest_phone = $2`, hotelId, guestPhone); } catch { /* best effort */ }
}

/** The last few messages either way, oldest first, excluding the one being handled now. */
export async function recentTurns(hotelId: string, guestPhone: string, currentMessageId: string, limit = 8): Promise<BrainTurn[]> {
  try {
    const rows = await prisma.message.findMany({
      where: { hotelId, guestPhone },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });
    return rows
      .filter((m) => m.messageId !== currentMessageId && m.body && m.body.trim())
      .slice(0, limit)
      .reverse()
      .map((m) => ({ role: m.direction === "inbound" ? "user" : "assistant", content: (m.body ?? "").trim() }));
  } catch { return []; }
}

/** The pending offer, phrased for the system prompt. */
export function describePending(ctx: GuestContext | null): string {
  if (!ctx) return "";
  const opts = ctx.options.map((o) => o.code + " " + o.name + " " + money(o.price)).join("; ");
  return "You just offered these instead of " + ctx.ask + " (" + ctx.qty + " wanted): " + opts + ". If this message picks one - by name, by number, or with a yes - put it in items with that exact code and qty " + ctx.qty + ". If they decline or talk about something else, leave items empty and just continue normally.";
}

const ORDINALS = ["first", "second", "third", "1st", "2nd", "3rd"];
const YES = ["yes", "yeah", "yep", "ok", "okay", "sure", "haan", "ha", "thik", "theek", "fine", "please", "go ahead"];

/** Server-side reading of a reply to a pending offer, for when the model returned nothing usable. */
function resolvePendingChoice(message: string, ctx: GuestContext, catalog: Catalog): Ask | null {
  const m = normalise(message);
  if (!m) return null;
  const options = ctx.options.map((o) => catalog.byCode.get(o.code)).filter((i): i is CatalogItem => !!i);
  if (options.length === 0) return null;
  const qtyMatch = m.match(/\b(\d{1,2})\b/);
  const qty = qtyMatch && Number(qtyMatch[1]) <= 20 && !/^\s*\d{1,2}\s*$/.test(m) ? Number(qtyMatch[1]) : ctx.qty;
  const digitOnly = /^\s*(\d)\s*$/.exec(m);
  if (digitOnly) {
    const idx = Number(digitOnly[1]) - 1;
    return options[idx] ? { text: options[idx].name, qty: ctx.qty, code: options[idx].code } : null;
  }
  const ord = ORDINALS.findIndex((o) => m.includes(o));
  if (ord >= 0 && options[ord % 3]) return { text: options[ord % 3].name, qty, code: options[ord % 3].code };
  let best: { item: CatalogItem; score: number } | null = null;
  for (const item of options) {
    const s = similarity(m, item.name);
    if (!best || s > best.score) best = { item, score: s };
  }
  if (best && best.score >= 0.45) return { text: best.item.name, qty, code: best.item.code };
  if (options.length === 1 && YES.some((y) => m === y || m.startsWith(y + " ") || m.endsWith(" " + y))) return { text: options[0].name, qty, code: options[0].code };
  return null;
}

/** Keep the model's opener only if it stays out of the facts; otherwise a plain one - or none when nothing was ordered. */
function opener(reply: string, mentions: string[], guestName: string | null, ordered: boolean): string | null {
  const r = reply.toLowerCase();
  const leaks = mentions.some((m) => m && r.includes(m.toLowerCase()))
    || /\bmenu\b|not available|unavailable|sold out|don.t have|do not have|not something we|instead|alternative|\bRs\.?\s?\d|\u20B9/i.test(reply);
  if (!leaks) return reply.trim();
  if (!ordered) return null;
  const first = (guestName ?? "").trim().split(/\s+/)[0];
  return "On it" + (first ? ", " + first : "") + "! Here are the details:";
}

const NO = ["no", "nah", "nope", "cancel", "nahi", "nai", "na", "not now", "no thanks", "leave it"];

/**
 * A short, unambiguous answer to a pending offer is handled without the model - "yes", "2",
 * "the paneer" come back in well under a second. Anything longer goes to the model, which still
 * sees the offer and the thread.
 */
export function fastPath(message: string, pending: GuestContext | null, catalog: Catalog): BrainOutput | null {
  if (isMenuQuestion(message)) {
    const dept = menuDeptFor(message, catalog);
    if (dept) return { requests: [], reply: "Of course.", showMenu: dept === "dining" ? "fb" : dept, sentiment: "neutral", needsHuman: false };
  }
  if (!pending) return null;
  const words = normalise(message).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 6) return null;
  const choice = resolvePendingChoice(message, pending, catalog);
  if (!choice || !choice.code) return null;
  const intent: "spa" | "room_service" = pending.dept === "spa" ? "spa" : "room_service";
  return {
    requests: [{ intent, detail: choice.text, priority: "normal", items: [{ id: choice.code, name: choice.text, qty: choice.qty }] }],
    reply: "Perfect.",
    sentiment: "neutral",
    needsHuman: false,
  };
}

/* ---------------------------------------------------------------- applying --------- */

type Ask = { text: string; qty: number; code?: string };
type Confirmed = { item: CatalogItem; qty: number };
type Unavailable = { ask: string; item: CatalogItem | null; reason: "sold_out" | "not_served_now" | "not_on_menu"; suggestions: CatalogItem[]; generic?: boolean; browse?: boolean };
type Ambiguous = { ask: string; qty: number; options: CatalogItem[] };
const AMBIGUITY_GAP = 0.1;

function asksFrom(r: BrainRequest, dept: CatalogDept, catalog: Catalog): Ask[] {
  const asks: Ask[] = [];
  for (const it of r.items ?? []) asks.push({ text: it.name, qty: Math.max(1, it.qty ?? 1), code: it.id });
  for (const n of r.notOnMenu ?? []) asks.push({ text: n, qty: 1 });
  if (asks.length > 0) return asks;
  // the brain gave us prose only - recognise catalog names inside it, else treat the whole detail as one ask
  const detail = normalise(r.detail);
  for (const item of catalog.items) {
    if (item.dept === dept && detail.includes(normalise(item.name))) asks.push({ text: item.name, qty: r.quantity ?? 1, code: item.code });
  }
  if (asks.length === 0 && r.detail.trim()) asks.push({ text: r.detail.trim(), qty: r.quantity ?? 1 });
  return asks;
}

function resolveAsks(asks: Ask[], dept: CatalogDept, catalog: Catalog): { confirmed: Confirmed[]; unavailable: Unavailable[]; ambiguous: Ambiguous[] } {
  const confirmed: Confirmed[] = [];
  const unavailable: Unavailable[] = [];
  const ambiguous: Ambiguous[] = [];
  const pool = catalog.items.filter((i) => i.dept === dept);
  for (const ask of asks) {
    let item: CatalogItem | null = ask.code ? catalog.byCode.get(ask.code) ?? null : null;
    if (item && item.dept !== dept) item = null;
    if (!item) {
      // rank the whole pool; two near-equal strong matches means we ask rather than guess
      const ranked = pool.map((i) => ({ item: i, score: similarity(ask.text, i.name) })).sort((a, b) => b.score - a.score);
      const best = ranked[0];
      if (best && best.score >= STRONG_MATCH) {
        const rivals = ranked.slice(1).filter((r) => r.score >= STRONG_MATCH && best.score - r.score < AMBIGUITY_GAP && availability(r.item, catalog.timezone).ok);
        if (rivals.length > 0 && availability(best.item, catalog.timezone).ok) {
          ambiguous.push({ ask: ask.text, qty: ask.qty, options: [best.item, ...rivals.map((r) => r.item)].slice(0, MAX_SUGGESTIONS) });
          continue;
        }
        item = best.item;
      }
    }
    if (!item) {
      const browse = browseCategory(ask.text, dept, catalog);
      if (browse) {
        unavailable.push({ ask: browse.label, item: null, reason: "not_on_menu", suggestions: browse.items, generic: true, browse: true });
        continue;
      }
      const near = bestMatch(ask.text, pool);
      const anchor = near && near.score >= ANCHOR_MATCH ? near.item : null;
      unavailable.push({ ask: ask.text, item: null, reason: "not_on_menu", suggestions: suggest(ask.text, dept, catalog, new Set(), anchor), generic: dept !== "spa" && isGenericAsk(ask.text) });
      continue;
    }
    const a = availability(item, catalog.timezone);
    if (!a.ok) {
      unavailable.push({ ask: ask.text, item, reason: a.reason, suggestions: suggest(item.name, dept, catalog, new Set([item.id]), item) });
      continue;
    }
    const qty = item.stock > 0 ? Math.min(ask.qty, item.stock) : ask.qty;
    const existing = confirmed.find((c) => c.item.id === item!.id);
    if (existing) existing.qty += qty; else confirmed.push({ item, qty });
  }
  return { confirmed, unavailable, ambiguous };
}

/** Race-safe stock decrement via the decrement_stock() function; falls back to a plain update if it is missing. */
async function takeStock(item: CatalogItem, qty: number): Promise<boolean> {
  if (item.stock <= 0) return true; // not tracked
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`select ok, new_stock, low from decrement_stock($1::uuid, $2::int)`, item.id, qty);
    const r = rows[0];
    if (!r) return false;
    if (r.low) log.warn("catalog: low stock", { item: item.name, remaining: num(r.new_stock) });
    return !!r.ok;
  } catch {
    try {
      const n = await prisma.$executeRawUnsafe(
        `update menu_items set stock = stock - $2, available = case when stock - $2 <= 0 then false else available end where id = $1::uuid and stock >= $2`, item.id, qty);
      return Number(n) > 0;
    } catch { return true; }
  }
}

async function placeOrder(hotelId: string, room: string | null, guestPhone: string, confirmed: Confirmed[]): Promise<string | null> {
  const total = confirmed.reduce((s, c) => s + c.item.price * c.qty, 0);
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `insert into orders (hotel_id, dept, room, guest_phone, status, total) values ($1, 'fb', $2, $3, 'placed', $4) returning id`,
      hotelId, room, guestPhone, Math.round(total * 100) / 100);
    const orderId = rows[0]?.id ? String(rows[0].id) : null;
    if (orderId) {
      for (const c of confirmed) {
        await prisma.$executeRawUnsafe(
          `insert into order_items (order_id, menu_item_id, name, unit_price, qty) values ($1::uuid, $2::uuid, $3, $4, $5)`,
          orderId, c.item.id, c.item.name, c.item.price, c.qty);
      }
    }
    return orderId;
  } catch (e) {
    log.warn("catalog: order not persisted", { detail: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

function itemLabel(i: CatalogItem, dept: CatalogDept): string {
  return i.name + " (" + money(i.price) + (dept === "spa" && i.durationMin ? ", " + i.durationMin + " min" : "") + ")";
}

/** The sentence for something we cannot serve: what, why, and what we have instead. */
function unavailableText(u: Unavailable, dept: CatalogDept): string {
  const parts = u.suggestions.map((i) => itemLabel(i, dept));
  const cat = dept === "spa" ? null : inferCategory(u.ask);
  const catLabel = cat ? categoryLabel(u.ask) : null;
  const fallback = !!cat && parts.length > 0 && !u.suggestions.some((i) => i.category != null && cat.test(i.category));
  if (u.browse) {
    if (parts.length === 0) return "Nothing in " + u.ask + " is available right now.";
    return u.ask + ": " + parts.join(", ") + ". Just tell me what you would like, and how many.";
  }
  if (u.generic) {
    if (parts.length === 0) return "We do not have " + askLabel(u.ask) + " on the menu right now.";
    if (fallback) return "We do not have " + (catLabel ?? askLabel(u.ask)) + " on the menu right now. You might like: " + parts.join(", ") + ".";
    return "For " + askLabel(u.ask) + ", here is what we have: " + parts.join(", ") + ". Just tell me which you would like.";
  }
  const name = u.item ? u.item.name : u.ask;
  let why: string;
  if (u.reason === "sold_out") why = name + " is sold out today.";
  else if (u.reason === "not_served_now" && u.item?.servedFrom && u.item?.servedTo) why = name + " is served " + to12h(u.item.servedFrom) + " to " + to12h(u.item.servedTo) + ".";
  else why = "Sorry, " + name + " is not on our menu.";
  if (fallback && catLabel) return why.replace(/\.$/, "") + " and we have no " + catLabel + " right now. You might like: " + parts.join(", ") + ".";
  if (parts.length === 0 && catLabel) return why.replace(/\.$/, "") + " and we have no " + catLabel + " right now.";
  if (parts.length === 0) return why + " We do not have anything similar right now.";
  if (parts.length === 1) return why + " Closest we have: " + parts[0] + ". Would you like that instead?";
  return why + " Closest we have: " + parts.join(", ") + ". Just tell me which you would like.";
}

function ambiguityText(a: Ambiguous, dept: CatalogDept): string {
  const opts = a.options.map((i) => itemLabel(i, dept));
  return "For " + a.ask + ", did you mean " + opts.slice(0, -1).join(", ") + " or " + opts[opts.length - 1] + "? Reply with the one you would like.";
}

function foodSummary(room: string | null, confirmed: Confirmed[], unavailable: Unavailable[], ambiguous: Ambiguous[] = []): string {
  const lines: string[] = [];
  if (confirmed.length) {
    lines.push("Your order" + (room ? " for Room " + room : "") + ":");
    for (const c of confirmed) lines.push("- " + c.qty + " x " + c.item.name + " - " + money(c.item.price * c.qty));
    const total = confirmed.reduce((s, c) => s + c.item.price * c.qty, 0);
    const prep = Math.max(0, ...confirmed.map((c) => c.item.prepMins));
    lines.push("Total " + money(total) + (prep ? ". About " + prep + " minutes." : "."));
  }
  for (const u of unavailable) lines.push((lines.length ? "\n" : "") + unavailableText(u, "fb"));
  for (const a of ambiguous) lines.push((lines.length ? "\n" : "") + ambiguityText(a, "fb"));
  return lines.join("\n");
}

function spaSummary(confirmed: Confirmed[], unavailable: Unavailable[], ambiguous: Ambiguous[] = []): string {
  const lines: string[] = [];
  if (confirmed.length) {
    lines.push("Spa request noted:");
    for (const c of confirmed) lines.push("- " + c.item.name + " (" + money(c.item.price) + (c.item.durationMin ? ", " + c.item.durationMin + " min" : "") + ")");
    lines.push("The spa team will confirm your time shortly.");
  }
  for (const u of unavailable) lines.push((lines.length ? "\n" : "") + unavailableText(u, "spa"));
  for (const a of ambiguous) lines.push((lines.length ? "\n" : "") + ambiguityText(a, "spa"));
  return lines.join("\n");
}

async function noteMissed(hotelId: string, dept: CatalogDept, room: string | null, guestPhone: string, unavailable: Unavailable[]): Promise<void> {
  for (const u of unavailable) {
    await recordMissedDemand({
      hotelId, roomNumber: room, guestPhone, department: dept, requestedItem: u.ask, source: "not_offered",
      declineReason: u.reason === "sold_out" ? "sold out" : u.reason === "not_served_now" ? "outside serving hours" : "not on menu",
    });
  }
}

/** The offer to remember for the guest's next message: an ambiguity to settle, else the first set of alternatives. */
function offerFrom(ambiguous: Ambiguous[], unavailable: Unavailable[], dept: CatalogDept, defaultQty: number): GuestContext | null {
  const pick = (items: CatalogItem[]) => items.map((i) => ({ code: i.code, name: i.name, price: i.price }));
  const a = ambiguous[0];
  if (a) return { kind: "choose", dept, ask: a.ask, qty: a.qty, options: pick(a.options) };
  const u = unavailable.find((x) => x.suggestions.length > 0);
  if (u) return { kind: "choose", dept, ask: u.ask, qty: defaultQty, options: pick(u.suggestions) };
  return null;
}

/**
 * Check the brain's answer against the catalog. Everything the guest asked to eat or drink is
 * resolved as ONE order (however many requests the brain split it into); things the hotel does not
 * offer are dropped and logged as missed demand; confirmed items become an order with real prices;
 * the guest's reply gets the exact summary appended. If Aria had just offered alternatives and the
 * guest is answering that offer, the answer is honoured even when the model missed it. Departments
 * with no catalog are left untouched.
 */
export async function applyCatalog(
  output: BrainOutput,
  catalog: Catalog,
  hotelId: string,
  session: { roomNumber?: string | null; claimedGuestName?: string | null },
  guestPhone: string,
  opts: { dryRun?: boolean; pending?: GuestContext | null; message?: string } = {}
): Promise<BrainOutput> {
  const room = session.roomNumber ?? null;
  const kept: BrainRequest[] = [];
  const summaries: string[] = [];
  const mentions: string[] = [];
  let nextContext: GuestContext | null = null;
  let touchedFood = false;
  let touchedSpa = false;
  let ordered = false;
  let deadEnd: CatalogDept | null = null;
  const placedItems: CatalogItem[] = [];

  const foodRequests = output.requests.filter((r) => r.intent === "room_service" && catalog.configured.fb);
  const spaRequests = output.requests.filter((r) => r.intent === "spa" && catalog.configured.spa);
  for (const r of output.requests) {
    if (!foodRequests.includes(r) && !spaRequests.includes(r)) kept.push(r);
  }

  // a reply to a pending offer that the model did not turn into items: read it ourselves
  const pending = opts.pending ?? null;
  const extraAsks: Ask[] = [];
  if (pending && opts.message) {
    const alreadyChosen = foodRequests.concat(spaRequests).some((r) => (r.items ?? []).some((it) => pending.options.some((o) => o.code === it.id)));
    if (!alreadyChosen) {
      const choice = resolvePendingChoice(opts.message, pending, catalog);
      if (choice) extraAsks.push(choice);
    }
  }

  const pendingDept = pending?.dept ?? "fb";
  if (foodRequests.length || (extraAsks.length && pendingDept === "fb")) {
    touchedFood = true;
    const asks = foodRequests.flatMap((r) => asksFrom(r, "fb", catalog)).concat(pendingDept === "fb" ? extraAsks : []);
    const { confirmed, unavailable, ambiguous } = resolveAsks(asks, "fb", catalog);
    const placed: Confirmed[] = [];
    for (const c of confirmed) {
      if (opts.dryRun || (await takeStock(c.item, c.qty))) placed.push(c);
      else unavailable.push({ ask: c.item.name, item: c.item, reason: "sold_out", suggestions: suggest(c.item.name, "fb", catalog, new Set([c.item.id]), c.item) });
    }
    if (placed.length) {
      ordered = true;
      placedItems.push(...placed.map((c) => c.item));
      const orderId = opts.dryRun ? null : await placeOrder(hotelId, room, guestPhone, placed);
      const total = placed.reduce((s, c) => s + c.item.price * c.qty, 0);
      const first = foodRequests[0] ?? { intent: "room_service" as const, detail: "", priority: "normal" as const };
      kept.push({
        ...first,
        intent: "room_service",
        detail: "Room service order: " + placed.map((c) => c.qty + " x " + c.item.name).join(", ") + " (total " + money(total) + (orderId ? ", order " + orderId.slice(0, 8) : "") + ")",
        quantity: placed.reduce((s, c) => s + c.qty, 0),
        priority: foodRequests.some((r) => r.priority === "urgent") ? "urgent" : first.priority,
      });
    }
    if (unavailable.length && !opts.dryRun) await noteMissed(hotelId, "fb", room, guestPhone, unavailable);
    summaries.push(foodSummary(room, placed, unavailable, ambiguous));
    if (!placed.length && !ambiguous.length && unavailable.length && unavailable.every((u) => u.suggestions.length === 0)) deadEnd = "fb";
    mentions.push(...placed.map((c) => c.item.name), ...unavailable.map((u) => u.ask), ...unavailable.flatMap((u) => u.suggestions.map((s) => s.name)));
    nextContext = offerFrom(ambiguous, unavailable, "fb", 1);
    log.info("catalog: room service resolved", { placed: placed.length, unavailable: unavailable.length, ambiguous: ambiguous.length, phone: guestPhone });
  }

  if (spaRequests.length || (extraAsks.length && pendingDept === "spa")) {
    touchedSpa = true;
    const asks = spaRequests.flatMap((r) => asksFrom(r, "spa", catalog)).concat(pendingDept === "spa" ? extraAsks : []);
    const { confirmed, unavailable, ambiguous } = resolveAsks(asks, "spa", catalog);
    if (confirmed.length) {
      ordered = true;
      const first = spaRequests[0] ?? { intent: "spa" as const, detail: "", priority: "normal" as const };
      const when = spaRequests.map((r) => r.whenText).find(Boolean);
      kept.push({
        ...first,
        intent: "spa",
        detail: "Spa: " + confirmed.map((c) => c.item.name + " (" + money(c.item.price) + (c.item.durationMin ? ", " + c.item.durationMin + " min" : "") + ")").join(", ") + (when ? " - " + when : ""),
      });
    }
    if (unavailable.length && !opts.dryRun) await noteMissed(hotelId, "spa", room, guestPhone, unavailable);
    summaries.push(spaSummary(confirmed, unavailable, ambiguous));
    if (!confirmed.length && !ambiguous.length && unavailable.length && unavailable.every((u) => u.suggestions.length === 0)) deadEnd = "spa";
    mentions.push(...confirmed.map((c) => c.item.name), ...unavailable.map((u) => u.ask));
    if (!nextContext) nextContext = offerFrom(ambiguous, unavailable, "spa", 1);
    log.info("catalog: spa resolved", { confirmed: confirmed.length, unavailable: unavailable.length, ambiguous: ambiguous.length, phone: guestPhone });
  }

  const declined = !!(pending && opts.message && NO.some((n) => normalise(opts.message!) === n));
  const history = catalog.configured.fb && (ordered || deadEnd || output.showMenu || (opts.message && isMenuQuestion(opts.message)))
    ? await loadGuestHistory(hotelId, guestPhone) : new Map<string, number>();

  // the menu itself, when asked for - by the model's flag or by the words
  const menuDept: CatalogDept | null = output.showMenu
    ? (output.showMenu === "spa" ? (catalog.configured.spa ? "spa" : null) : (catalog.configured.fb ? "fb" : null))
    : (opts.message && isMenuQuestion(opts.message) ? menuDeptFor(opts.message, catalog) : null);
  if (menuDept && !ordered) summaries.push(menuDigest(catalog, menuDept, history));

  // a dead end gets a next step: something that suits the moment, then what the hotel does have
  if (!ordered && !menuDept && deadEnd) {
    const pick = deadEnd === "fb" ? picksFor(catalog, "fb", history, { limit: 1, minScore: 2 })[0] : undefined;
    if (pick) {
      summaries.push("You might enjoy " + pickLine(pick, "fb") + ". Shall I send one up, or would you like to see the menu?");
      nextContext = { kind: "choose", dept: "fb", ask: "something else", qty: 1, options: [{ code: pick.item.code, name: pick.item.name, price: pick.item.price }] };
    } else {
      summaries.push(guideText(catalog, deadEnd));
    }
  }

  // one gentle suggestion with a fresh order: a drink that suits the moment, or a dessert in the evening
  if (ordered && touchedFood && !nextContext && !extraAsks.length && !declined) {
    const m = momentOf(catalog.timezone, catalog.now);
    const has = (test: (i: CatalogItem) => boolean) => placedItems.some((i) => test(i));
    let pick: Pick | undefined;
    if (!has((i) => kindOf(i) === "drink")) pick = picksFor(catalog, "fb", history, { kind: "drink", limit: 1, minScore: 2, exclude: new Set(placedItems.map((i) => i.id)) })[0];
    if (!pick && (m.dayPart === "night" || m.dayPart === "evening") && !has(isDessert)) pick = picksFor(catalog, "fb", history, { limit: 1, minScore: 2, exclude: new Set(placedItems.map((i) => i.id)) }).filter((p) => isDessert(p.item))[0];
    if (pick) {
      summaries.push("Would you like " + itemLabel(pick.item, "fb") + " with that? " + capitalise(pick.reason) + ".");
      nextContext = { kind: "choose", dept: "fb", ask: "with your order", qty: 1, options: [{ code: pick.item.code, name: pick.item.name, price: pick.item.price }] };
    }
  }
  if (!opts.dryRun) {
    if (nextContext) await saveGuestContext(hotelId, guestPhone, nextContext);
    else if (touchedFood || touchedSpa || declined) await clearGuestContext(hotelId, guestPhone);
  }

  const extra = summaries.filter(Boolean).join("\n\n");
  if (!extra) {
    const dangling = /\b(below|details)\b/i.test(output.reply);
    return dangling ? { ...output, requests: kept, reply: output.reply.replace(/[^.!?]*\b(below|details)\b[^.!?]*[.!?]?/gi, "").trim() || "How can I help?" } : { ...output, requests: kept };
  }
  let head = opener(output.reply, mentions, session.claimedGuestName ?? null, ordered);
  // a bare apology on top of the server's own apology reads doubled
  if (head && /^(so )?sorry[.!]*$|^apologies[.!]*$/i.test(head.trim()) && /^sorry/i.test(extra)) head = null;
  return { ...output, requests: kept, reply: head ? head + "\n\n" + extra : extra };
}
