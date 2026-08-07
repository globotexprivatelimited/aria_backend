import { Router } from "express";
import { verifyToken } from "../auth/service";
import { sendActivation, confirmToken, getVerificationStatus } from "../emailverify/service";
export const emailVerifyRouter = Router();

emailVerifyRouter.get("/api/auth/verify", async (req, res) => {
  const r = await confirmToken(String(req.query.token ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});

emailVerifyRouter.get("/api/auth/verify/status", async (req, res) => {
  const auth = req.header("authorization") ?? "";
  const tk = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = tk ? verifyToken(tk) : null;
  if (!user) return res.status(401).json({ ok: false, error: "Not signed in." });
  const r = await getVerificationStatus(user.hotelId);
  return res.status(r.ok ? 200 : 400).json(r);
});

emailVerifyRouter.post("/api/auth/verify/resend", async (req, res) => {
  const auth = req.header("authorization") ?? "";
  const tk = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = tk ? verifyToken(tk) : null;
  if (!user) return res.status(401).json({ ok: false, error: "Not signed in." });
  const r = await sendActivation(user.hotelId);
  return res.status(r.ok ? 200 : 400).json(r);
});
