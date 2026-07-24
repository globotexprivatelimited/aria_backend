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
  quantity: z.number().int().positive().optional(),
  whenText: z.string().max(120).optional(),
});

export const BrainOutput = z.object({
  requests: z.array(BrainRequest).max(6),
  reply: z.string().min(1).max(900),
  sentiment: z.enum(["happy", "neutral", "unhappy"]).default("neutral"),
  needsHuman: z.boolean().default(false),
});

export type BrainRequest = z.infer<typeof BrainRequest>;
export type BrainOutput = z.infer<typeof BrainOutput>;
