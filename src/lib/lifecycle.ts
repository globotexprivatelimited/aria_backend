import type { Server } from "http";
import { prisma } from "../db";
import { log } from "./logger";

let shuttingDown = false;
let inFlight = 0;

export function isShuttingDown(): boolean {
  return shuttingDown;
}
export function jobStarted(): void {
  inFlight += 1;
}
export function jobFinished(): void {
  inFlight = Math.max(0, inFlight - 1);
}
export function inFlightCount(): number {
  return inFlight;
}

export async function checkReady(): Promise<{ ready: boolean; db: boolean }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ready: !shuttingDown, db: true };
  } catch {
    return { ready: false, db: false };
  }
}

export function installShutdown(server: Server): void {
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutdown starting", { signal, inFlight });

    server.close(() => log.info("http server closed"));

    const deadline = Date.now() + 15000;
    while (inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (inFlight > 0) log.warn("shutdown with jobs still running", { inFlight });

    await prisma.$disconnect();
    log.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    log.error("unhandled rejection", { detail: String(reason) });
  });
  process.on("uncaughtException", (err) => {
    log.error("uncaught exception", { detail: err instanceof Error ? err.message : String(err) });
  });
}
