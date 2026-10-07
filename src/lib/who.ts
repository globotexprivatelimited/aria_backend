import type { Request } from "express";
import { verifyToken } from "../auth/service";

/** The signed-in person's name from the console's session token - for audit trails, never for authorisation. Empty when there is no token. */
export function staffNameOf(req: Request): string {
  const auth = req.header("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return "";
  const who = verifyToken(auth.slice(7)) as unknown as Record<string, unknown> | null;
  return who ? String(who.fullName ?? who.email ?? who.staffUserId ?? "").trim() : "";
}
