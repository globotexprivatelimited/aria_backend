import { Router } from "express";
import { verifyToken } from "../auth/service";
import { acceptRequest, declineRequest, claimRequest, completeRequest, problemRequest } from "../executor/actions";
import { prisma } from "../db";

export const staffActionsRouter = Router();

// Staff act on a request from the portal - authenticated by their own session token.
staffActionsRouter.post("/api/staff/request-action", async (req, res) => {
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = token ? verifyToken(token) : null;
  if (!user) return res.status(401).json({ ok: false, error: "Not signed in." });

  const { requestId, command } = req.body ?? {};
  if (!requestId || !command) return res.status(400).json({ ok: false, error: "requestId and command required" });

  try {
    // the request must belong to this staff member's hotel
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select id, "hotelId", department, status from "Request" where id::text = $1 limit 1`, String(requestId));
    const reqRow = rows[0];
    if (!reqRow) return res.status(404).json({ ok: false, error: "Request not found." });
    if (String(reqRow.hotelId) !== String(user.hotelId)) return res.status(403).json({ ok: false, error: "Not your hotel." });

    // and must be in a department they actually have access to
    const depts = await prisma.$queryRawUnsafe<any[]>(
      `select dept from staff_departments where staff_user_id::text = $1 and active = true`, user.staffUserId);
    const allowed = depts.map((d: any) => d.dept);
    if (!allowed.includes(reqRow.department)) return res.status(403).json({ ok: false, error: "Not your department." });

    const who = user.fullName || "Staff";
    const cmd = String(command).toUpperCase();
    const ref = String(reqRow.id).slice(0, 8);
    if (cmd === "ACCEPT") await acceptRequest(user.hotelId, ref, who);
    else if (cmd === "CLAIM") await claimRequest(user.hotelId, ref, who);
    else if (cmd === "DONE") await completeRequest(user.hotelId, ref, who);
    else if (cmd === "REJECT") await declineRequest(user.hotelId, ref, who);
    else if (cmd === "ISSUE") await problemRequest(user.hotelId, ref, who);
    else return res.status(400).json({ ok: false, error: "Unknown command." });

    const after = await prisma.$queryRawUnsafe<any[]>(`select status from "Request" where id::text = $1`, reqRow.id);
    return res.json({ ok: true, data: { status: after[0]?.status } });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "Action failed." });
  }
});
