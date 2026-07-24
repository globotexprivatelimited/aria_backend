import { maskPhone, redact } from "../privacy/redact";

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < MIN) return;
  const safeMeta: Record<string, unknown> = {};
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (typeof v === "string") {
        safeMeta[k] = /phone|waId|guest/i.test(k) ? maskPhone(v) : redact(v);
      } else {
        safeMeta[k] = v;
      }
    }
  }
  const line = {
    at: new Date().toISOString(),
    level,
    msg: redact(msg),
    ...safeMeta,
  };
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(JSON.stringify(line));
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};
