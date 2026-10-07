import type { Request } from "express";
import { staffNameOf } from "./who";

export type OptIn = { source: "registration_card"; by: string };

/**
 * Meta's rule: nothing is sent to a number without an opt-in the business can show. The registration card at the
 * desk carries the line; the receptionist ticks it in the console; this records who ticked it. No tick, no welcome.
 */
export function optInOf(req: Request): OptIn | null {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ticked = body.optIn === true || body.optIn === "true" || body.whatsappOptIn === true || body.whatsappOptIn === "true";
  if (!ticked) return null;
  const verified = staffNameOf(req);
  const claimed = typeof body.optInBy === "string" && body.optInBy.trim() ? body.optInBy.trim() + " (unverified)" : "staff";
  return { source: "registration_card", by: verified || claimed };
}
