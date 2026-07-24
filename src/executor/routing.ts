import type { BrainRequest } from "../brain/schema";

export type Dept =
  | "housekeeping" | "fb" | "dining" | "activities"
  | "spa" | "maintenance" | "front_desk" | "gm" | "events";

/** Which team owns each kind of request. */
const INTENT_TO_DEPT: Record<string, Dept> = {
  housekeeping: "housekeeping",
  room_service: "fb",
  dining: "dining",
  activities: "activities",
  spa: "spa",
  maintenance: "maintenance",
  concierge: "front_desk",
  unclear: "front_desk",
};

export function departmentFor(intent: string): Dept {
  return INTENT_TO_DEPT[intent] ?? "front_desk";
}

/**
 * Bookings are not simple tasks - they need a human to confirm a slot,
 * and they earn revenue. They follow the booking flow, not the task flow.
 */
export function isBooking(intent: string): boolean {
  return intent === "dining" || intent === "spa" || intent === "activities";
}

/** A request that must never be auto-actioned. */
export function needsHumanJudgement(r: BrainRequest): boolean {
  return r.priority === "human_required" || r.priority === "emergency";
}
