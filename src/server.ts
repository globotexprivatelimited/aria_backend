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
app.use(cors());
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
