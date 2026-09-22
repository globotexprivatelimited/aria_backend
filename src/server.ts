import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cron from "node-cron";
import swaggerUi from "swagger-ui-express";
import { openapiSpec } from "./lib/openapi";
import { metaRouter } from "./webhooks/meta";
import { hotelSettingsRouter } from "./routes/hotelsettings";
import { adminRouter } from "./webhooks/admin";
import { frontdeskRouter } from "./routes/frontdesk";
import { dashboardRouter } from "./routes/dashboard";
import { privacyRouter } from "./routes/privacy";
import { universalRouter } from "./routes/universal";
import { onboardingRouter } from "./routes/onboarding";
import { registerRouter } from "./routes/register";
import { menuRouter } from "./routes/menu";
import { slotsRouter } from "./routes/slots";
import { requestsRouter } from "./routes/requests";
import { authRouter } from "./routes/auth";
import { revenueRouter } from "./routes/revenue";
import { roomsRouter } from "./routes/rooms";
import { deptItemsRouter } from "./routes/deptitems";
import { staffAccessRouter } from "./routes/staffaccess";
import { staffActionsRouter } from "./routes/staffactions";
import { presenceRouter } from "./routes/presence";
import { deptConfigRouter } from "./routes/deptconfig";
import { deptDetailRouter } from "./routes/deptdetail";
import { missedDemandRouter } from "./routes/misseddemand";
import { emailVerifyRouter } from "./routes/emailverify";
import { founderRouter } from "./routes/founder";
import { slotBookingRouter } from "./routes/slotbooking";
import { passwordResetRouter } from "./routes/passwordreset";
import { runSelfHealing } from "./session/selfHealing";
import { runRetentionPurge } from "./privacy/retention";
import { escalateStaleBookings } from "./dining";
import { expireWaitlistHolds } from "./activities";
import { sendDueTriggers } from "./proactive";
import { log } from "./lib/logger";
import { errorHandler, notFound } from "./lib/errors";
import { checkReady, installShutdown, inFlightCount } from "./lib/lifecycle";
import { queueDepth } from "./lib/queue";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { tenantGuard, isPlaceholderSecret } from "./lib/security";

dotenv.config();

const app = express();
app.disable("x-powered-by");
// only our own front ends may call this API from a browser
// a production deploy must not fall back to the development secrets
if (process.env.NODE_ENV === "production") {
  const weak: string[] = [];
  if (isPlaceholderSecret(process.env.ADMIN_API_KEY)) weak.push("ADMIN_API_KEY");
  if (isPlaceholderSecret(process.env.JWT_SECRET)) weak.push("JWT_SECRET");                  // D-023: a long placeholder is still a placeholder
  if (isPlaceholderSecret(process.env.META_VERIFY_TOKEN, 16)) weak.push("META_VERIFY_TOKEN"); // D-012
  if (!process.env.META_APP_SECRET) weak.push("META_APP_SECRET");                             // D-001: needed to verify webhooks
  if (weak.length) {
    console.error("Refusing to start: set a strong, non-placeholder " + weak.join(", ") + " before deploying.");
    process.exit(1);
  }
  app.set("trust proxy", 1); // Render sits behind a proxy; needed for correct per-client rate limiting
}

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
  .split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);              // curl, server-to-server, health checks
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));
// D-013: standard security headers. CSP is off because this is a JSON API behind CORS, not a website.
app.use(helmet({ contentSecurityPolicy: false }));
// keep the raw bytes so the Meta webhook can verify X-Hub-Signature-256 (D-001)
app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf); } }));

// D-007: rate limiting. Generous on the API, tight on login. The Meta webhook is exempt - Meta bursts and retries.
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300), standardHeaders: "draft-7", legacyHeaders: false });
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: Number(process.env.LOGIN_ATTEMPTS_PER_15_MIN ?? 10), standardHeaders: "draft-7", legacyHeaders: false,
  message: { ok: false, error: "Too many attempts. Please try again in 15 minutes." },
});
app.use("/api", apiLimiter);
app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/set-password", loginLimiter);
// D-005: a signed-in staff member may only touch their own hotel (founders see all)
app.use("/api", tenantGuard);

app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    log.info("request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - started,
    });
  });
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "aria-api", commit: (process.env.RENDER_GIT_COMMIT ?? "local").slice(0, 7), brain: Boolean(process.env.ANTHROPIC_API_KEY), model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6", time: new Date().toISOString() });
});

app.get("/ready", async (_req, res) => {
  const state = await checkReady();
  res.status(state.ready ? 200 : 503).json({
    ...state,
    inFlightJobs: inFlightCount(),
    queues: queueDepth(),
  });
});

// D-016: the WATI and AiSensy webhook routers are no longer mounted - Meta Cloud API is the only guest channel.
app.use(metaRouter);
app.use(hotelSettingsRouter);
app.use(adminRouter);
app.use(frontdeskRouter);
app.use(dashboardRouter);
app.use(privacyRouter);
app.use(universalRouter);
app.use(onboardingRouter);
app.use(registerRouter);
app.use(menuRouter);
app.use(slotsRouter);
app.use(requestsRouter);
app.use(authRouter);
app.use(revenueRouter);
app.use(roomsRouter);
app.use(deptItemsRouter);
app.use(staffAccessRouter);
app.use(staffActionsRouter);
app.use(presenceRouter);
app.use(deptConfigRouter);
app.use(deptDetailRouter);
app.use(missedDemandRouter);
app.use(emailVerifyRouter);
app.use(founderRouter);
app.use(slotBookingRouter);
app.use(passwordResetRouter);

// D-010: the API map is not public in production
const docsGuard = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (process.env.NODE_ENV !== "production") return next();
  if (req.header("x-admin-key") === process.env.ADMIN_API_KEY) return next();
  res.status(401).json({ error: "unauthorized" });
};
app.use("/docs", docsGuard);
app.use("/openapi.json", docsGuard);
app.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(openapiSpec as unknown as object, {
    customSiteTitle: "Aria API",
    swaggerOptions: { persistAuthorization: true, docExpansion: "list" },
  })
);
app.get("/openapi.json", (_req, res) => res.json(openapiSpec));

app.use(notFound);
app.use(errorHandler);

cron.schedule("30 3 * * *", () => {
  runRetentionPurge().catch((e) => log.error("retention job failed", { detail: String(e) }));
});
cron.schedule("*/5 * * * *", () => {
  escalateStaleBookings().catch((e) => log.error("dining escalation failed", { detail: String(e) }));
  expireWaitlistHolds().catch((e) => log.error("waitlist expiry failed", { detail: String(e) }));
  sendDueTriggers().catch((e) => log.error("proactive send failed", { detail: String(e) }));
});
cron.schedule("0 * * * *", () => {
  runSelfHealing().catch((e) => log.error("self-heal job failed", { detail: String(e) }));
});

const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, () => {
  log.info("aria-api listening", { port, env: process.env.NODE_ENV ?? "development" });
});

installShutdown(server);
