export type AdminCommand =
  | { kind: "emergency_on" }
  | { kind: "emergency_off" }
  | { kind: "checkin"; room: string; phone: string; name: string }
  | { kind: "checkout"; target: string }
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
  if (head === "CHECKOUT") {
    const target = parts[1];
    if (target) return { kind: "checkout", target };
    return { kind: "unknown" };
  }
  return { kind: "unknown" };
}
