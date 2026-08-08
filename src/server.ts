import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cron from "node-cron";
import swaggerUi from "swagger-ui-express";
import { openapiSpec } from "./lib/openapi";
import { watiRouter } from "./webhooks/wati";
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
import { aisensyProbeRouter } from "./routes/aisensyprobe";
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

dotenv.config();

const app = express();
app.disable("x-powered-by");
// only our own front ends may call this API from a browser
// a production deploy must not fall back to the development secrets
if (process.env.NODE_ENV === "production") {
  const weak: string[] = [];
  if (!process.env.ADMIN_API_KEY || process.env.ADMIN_API_KEY === "dev-admin-key") weak.push("ADMIN_API_KEY");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) weak.push("JWT_SECRET");
  if (weak.length) {
    console.error("Refusing to start: set a strong " + weak.join(" and ") + " before deploying.");
    process.exit(1);
  }
}

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
  .split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);              // curl, server-to-server, health checks
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Origin not allowed: " + origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));

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
  res.json({ ok: true, service: "aria-api", time: new Date().toISOString() });
});

app.get("/ready", async (_req, res) => {
  const state = await checkReady();
  res.status(state.ready ? 200 : 503).json({
    ...state,
    inFlightJobs: inFlightCount(),
    queues: queueDepth(),
  });
});

app.use(watiRouter);
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
app.use(aisensyProbeRouter);
app.use(passwordResetRouter);

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
