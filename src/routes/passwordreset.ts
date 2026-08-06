import { Router } from "express";
import { requestReset, validateResetToken, performReset } from "../passwordreset/service";
export const passwordResetRouter = Router();

passwordResetRouter.post("/api/auth/forgot", async (req, res) => {
  const { email } = req.body ?? {};
  const r = await requestReset(String(email ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});
passwordResetRouter.get("/api/auth/reset/validate", async (req, res) => {
  const r = await validateResetToken(String(req.query.token ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});
passwordResetRouter.post("/api/auth/reset", async (req, res) => {
  const { token, password } = req.body ?? {};
  const r = await performReset(String(token ?? ""), String(password ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});
