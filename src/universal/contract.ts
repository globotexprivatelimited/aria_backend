import { z } from "zod";

/**
 * The ONE canonical shape every hotel system maps into.
 * Adapters translate their own payloads to this; the core only ever sees this.
 */
export const CanonicalCheckin = z.object({
  hotelId: z.string().min(1),
  guestName: z.string().min(1).max(120),
  phone: z.string().min(6).max(20),
  room: z.string().min(1).max(20),
  checkoutAt: z.string().datetime().optional(),  // ISO 8601
  source: z.string().max(40).optional(),         // which adapter produced this
});

export const CanonicalCheckout = z.object({
  hotelId: z.string().min(1),
  room: z.string().max(20).optional(),
  phone: z.string().max(20).optional(),
  source: z.string().max(40).optional(),
}).refine((d) => d.room || d.phone, { message: "room or phone is required" });

export const CanonicalUpdate = z.object({
  hotelId: z.string().min(1),
  room: z.string().min(1).max(20),
  newRoom: z.string().max(20).optional(),
  newCheckoutAt: z.string().datetime().optional(),
  source: z.string().max(40).optional(),
});

export type CanonicalCheckin = z.infer<typeof CanonicalCheckin>;
export type CanonicalCheckout = z.infer<typeof CanonicalCheckout>;
export type CanonicalUpdate = z.infer<typeof CanonicalUpdate>;
