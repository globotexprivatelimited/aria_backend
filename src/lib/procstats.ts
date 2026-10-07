import { monitorEventLoopDelay } from "perf_hooks";

/**
 * The process's own vital signs - memory, CPU time used so far, and how late the event loop has been running since
 * the last reading. Read by the load test, and useful for the 48-hour stability check (acceptance B12).
 */
const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();

export type ProcessStats = { rssMb: number; heapUsedMb: number; cpuUserMs: number; cpuSystemMs: number; uptimeSeconds: number; eventLoopLagMs: { p50: number; p99: number; max: number } };

const mb = (n: number): number => Math.round((n / 1048576) * 10) / 10;
const ms = (ns: number): number => (Number.isFinite(ns) ? Math.round(ns / 1e5) / 10 : 0);

export function processStats(): ProcessStats {
  const m = process.memoryUsage(); const c = process.cpuUsage();
  const out: ProcessStats = { rssMb: mb(m.rss), heapUsedMb: mb(m.heapUsed), cpuUserMs: Math.round(c.user / 1000), cpuSystemMs: Math.round(c.system / 1000), uptimeSeconds: Math.round(process.uptime()), eventLoopLagMs: { p50: ms(lag.percentile(50)), p99: ms(lag.percentile(99)), max: ms(lag.max) } };
  lag.reset();
  return out;
}
