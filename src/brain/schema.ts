import { z } from "zod";

export const INTENTS = ["housekeeping", "room_service", "dining", "activities", "concierge", "spa", "maintenance", "unclear"] as const;
export const PRIORITIES = ["normal", "urgent", "human_required", "emergency"] as const;

/*
 * Claude's answer, read forgivingly. A stray null, a zero quantity or an unknown label becomes a safe default
 * instead of a rejection - a rejection throws away a good reply and sends the guest the fallback. The reply
 * itself must exist; everything else bends.
 */
const count = (max: number) => (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && isFinite(n) && n >= 1 ? Math.min(Math.round(n), max) : undefined;
};
const trimmed = (max: number) => (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export const BrainItem = z.object({
  id: z.preprocess((x) => (x == null || x === "" ? undefined : String(x).slice(0, 12)), z.string().max(12).optional()),
  name: z.preprocess(trimmed(80), z.string().min(1).max(80)),
  qty: z.preprocess((x) => count(20)(x) ?? 1, z.number().int().positive().max(20)),
});

export const BrainRequest = z.object({
  intent: z.preprocess((v) => (typeof v === "string" && (INTENTS as readonly string[]).includes(v) ? v : "unclear"), z.enum(INTENTS)),
  detail: z.preprocess((v) => trimmed(500)(v) ?? "guest request", z.string().min(1).max(500)),
  priority: z.preprocess((v) => (typeof v === "string" && (PRIORITIES as readonly string[]).includes(v) ? v : "normal"), z.enum(PRIORITIES)),
  quantity: z.preprocess(count(100), z.number().int().positive().max(100).optional()),
  whenText: z.preprocess(trimmed(120), z.string().max(120).optional()),
  items: z.preprocess((v) => (Array.isArray(v) ? v.filter((it) => isObj(it) && !!trimmed(80)(it.name)).slice(0, 10) : undefined), z.array(BrainItem).max(10).optional()),
  notOnMenu: z.preprocess((v) => (Array.isArray(v) ? v.map(trimmed(80)).filter((s): s is string => !!s).slice(0, 6) : undefined), z.array(z.string().min(1).max(80)).max(6).optional()),
});

export const BrainOutput = z.object({
  requests: z.preprocess((v) => (Array.isArray(v) ? v.filter(isObj).slice(0, 6) : []), z.array(BrainRequest).max(6)),
  reply: z.preprocess(trimmed(1500), z.string().min(1).max(1500)),
  sentiment: z.preprocess((v) => (v === "happy" || v === "unhappy" ? v : "neutral"), z.enum(["happy", "neutral", "unhappy"])),
  needsHuman: z.preprocess((v) => v === true || v === "true", z.boolean()),
  showMenu: z.preprocess((v) => (v === "fb" || v === "spa" ? v : v === "all" || v === true ? "fb" : undefined), z.enum(["fb", "spa"]).optional()),
  // the model sets this when it has answered a menu or recommendation question itself, so the server adds no menu of its own
  answeredMenu: z.preprocess((v) => (v === true || v === "true" ? true : v === false || v === "false" ? false : undefined), z.boolean().optional()),
});

export type BrainRequest = z.infer<typeof BrainRequest>;
export type BrainOutput = z.infer<typeof BrainOutput>;
