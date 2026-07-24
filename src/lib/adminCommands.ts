export type AdminCommand =
  | { kind: "emergency_on" }
  | { kind: "emergency_off" }
  | { kind: "checkin"; room: string; phone: string; name: string }
  | { kind: "checkout"; target: string }
  | { kind: "confirm"; ref: string; revenue?: number }
  | { kind: "alt"; ref: string; time: string }
  | { kind: "decline"; ref: string; reason?: string }
  | { kind: "waitlist"; ref: string }
  | { kind: "cancel"; ref: string }
  | { kind: "help" }
  | { kind: "unknown" };

export function parseAdminCommand(text: string): AdminCommand {
  const t = text.trim();
  const upper = t.toUpperCase();
  if (upper === "EMERGENCY MODE ON" || upper === "EMERGENCY ON") return { kind: "emergency_on" };
  if (upper === "EMERGENCY MODE OFF" || upper === "EMERGENCY OFF") return { kind: "emergency_off" };
  if (upper === "HELP") return { kind: "help" };

  const parts = t.split(/\s+/);
  const head = (parts[0] ?? "").toUpperCase();

  if (head === "CHECKIN") {
    const room = parts[1];
    const phone = parts[2];
    const name = parts.slice(3).join(" ");
    if (room && phone && name) return { kind: "checkin", room, phone, name };
    return { kind: "unknown" };
  }
  if (head === "WAITLIST") {
    const ref = parts[1];
    if (ref) return { kind: "waitlist", ref };
    return { kind: "unknown" };
  }
  if (head === "CANCEL") {
    const ref = parts[1];
    if (ref) return { kind: "cancel", ref };
    return { kind: "unknown" };
  }
  if (head === "CONFIRM") {
    const ref = parts[1];
    const revenue = parts[2] ? Number(parts[2].replace(/[^0-9.]/g, "")) : undefined;
    if (ref) return { kind: "confirm", ref, revenue: Number.isFinite(revenue) ? revenue : undefined };
    return { kind: "unknown" };
  }
  if (head === "ALT") {
    const ref = parts[1];
    const time = parts.slice(2).join(" ");
    if (ref && time) return { kind: "alt", ref, time };
    return { kind: "unknown" };
  }
  if (head === "DECLINE") {
    const ref = parts[1];
    const reason = parts.slice(2).join(" ");
    if (ref) return { kind: "decline", ref, reason: reason || undefined };
    return { kind: "unknown" };
  }
  if (head === "CHECKOUT") {
    const target = parts[1];
    if (target) return { kind: "checkout", target };
    return { kind: "unknown" };
  }
  return { kind: "unknown" };
}
