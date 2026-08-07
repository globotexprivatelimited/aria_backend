import type { Dept } from "./routing";
import { cachedDeptMode } from "../deptconfig/service";

/**
 * Two ways a department behaves (from the product logic doc):
 *  A = ACCEPT / DECLINE - a human decides before the guest is promised anything.
 *  B = AUTO - the guest is promised instantly; staff just fulfil.
 * Maintenance is a special case: auto-acknowledged, never declined, tracked.
 */
export type DeptType = "accept_decline" | "auto" | "maintenance";

const DEPT_TYPE: Record<Dept, DeptType> = {
  spa: "accept_decline",
  front_desk: "accept_decline",
  activities: "accept_decline",
  events: "accept_decline",
  dining: "accept_decline",     // restaurant table reservations - may be full
  fb: "auto",                   // in-room dining - a core promise
  housekeeping: "auto",         // towels, cleaning - a core promise
  maintenance: "maintenance",   // never declined, always tracked
  gm: "accept_decline",
};

export function deptType(dept: Dept, hotelId?: string): DeptType {
  // a GM can override a department mode per hotel; otherwise use the product default
  if (hotelId) {
    const configured = cachedDeptMode(hotelId, dept);
    if (configured) return configured;
  }
  return DEPT_TYPE[dept] ?? "accept_decline";
}

/** What the guest hears the instant the request lands, before any human acts. */
export function acknowledgementFor(dept: Dept, detail: string): string {
  switch (deptType(dept)) {
    case "auto":
      return dept === "fb"
        ? "Order placed - it is on its way to your room."
        : "On its way - our team is taking care of it now.";
    case "maintenance":
      return "Our team is on it - someone will be with you shortly to sort this out.";
    case "accept_decline":
    default:
      return "Let me check that for you - one moment.";
  }
}

/** Which staff actions are valid for a department's type. */
export function validActions(dept: Dept): string[] {
  switch (deptType(dept)) {
    case "auto":
      return ["CLAIM", "DONE", "PROBLEM"];
    case "maintenance":
      return ["CLAIM", "DONE", "PROBLEM"];
    case "accept_decline":
    default:
      return ["ACCEPT", "DECLINE", "ALTERNATIVE"];
  }
}
