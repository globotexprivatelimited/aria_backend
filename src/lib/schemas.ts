import { z } from "zod";

export const WatiInbound = z
  .object({
    waId: z.string().optional(),
    senderName: z.string().optional(),
    text: z.string().optional(),
    type: z.string().optional(),
    whatsappMessageId: z.string().optional(),
    id: z.string().optional(),
    eventType: z.string().optional(),
  })
  .passthrough();

export type WatiInbound = z.infer<typeof WatiInbound>;
