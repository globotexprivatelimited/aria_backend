import { z } from "zod";

export const INTENTS = [
  "housekeeping",
  "room_service",
  "dining",
  "activities",
  "concierge",
  "spa",
  "maintenance",
  "unclear",
] as const;

export const PRIORITIES = ["normal", "urgent", "human_required", "emergency"] as const;

export const BrainRequest = z.object({
  intent: z.enum(INTENTS),
  detail: z.string().min(1).max(500),
  priority: z.enum(PRIORITIES).default("normal"),
  quantity: z.preprocess((v) => v ?? undefined, z.number().int().positive().optional()),
  whenText: z.preprocess((v) => v ?? undefined, z.string().max(120).optional()),
  items: z.preprocess((v) => v ?? undefined, z.array(z.object({ id: z.preprocess((x) => x ?? undefined, z.string().max(12).optional()), name: z.string().min(1).max(80), qty: z.preprocess((x) => x ?? undefined, z.number().int().positive().max(20).default(1)) })).max(10).optional()),
  notOnMenu: z.preprocess((v) => v ?? undefined, z.array(z.string().min(1).max(80)).max(6).optional()),
});

export const BrainOutput = z.object({
  requests: z.array(BrainRequest).max(6),
  reply: z.string().min(1).max(900),
  sentiment: z.enum(["happy", "neutral", "unhappy"]).default("neutral"),
  needsHuman: z.boolean().default(false),
  showMenu: z.preprocess((v) => (v === "fb" || v === "spa" ? v : v === "all" || v === true ? "fb" : undefined), z.enum(["fb", "spa"]).optional()),
});

export type BrainRequest = z.infer<typeof BrainRequest>;
export type BrainOutput = z.infer<typeof BrainOutput>;
