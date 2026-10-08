import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { summarizeTimings } from "../lib/stageTimer";

/**
 * pnpm timing [file] - where a guest's wait for a reply goes, stage by stage (pending item 16), from the "reply timing"
 * lines the API logs: the newest load test server log by default, or any saved log file (a Render log download works).
 */
function newestServerLog(): string | null {
  const dir = "loadtest-reports";
  if (!existsSync(dir)) return null;
  const logs = readdirSync(dir).filter((f) => /-server\.log$/.test(f)).map((f) => join(dir, f));
  logs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return logs[0] ?? null;
}

const file = process.argv[2] ?? newestServerLog();
if (!file || !existsSync(file)) {
  console.log("no log to read - run pnpm loadtest first, or name a log file: pnpm timing path\\to\\file.log");
  process.exit(1);
}
const { replies, rows } = summarizeTimings(readFileSync(file, "utf8"));
if (!replies) {
  console.log(file + ": no reply timing lines - the API writes them from the change that added them onward");
  process.exit(0);
}
const reply = rows.find((r) => r.stage === "reply")?.median ?? 0;
const pad = (s: string, w: number): string => (s.length >= w ? s + " " : s + " ".repeat(w - s.length));
const sec = (ms: number): string => (ms / 1000).toFixed(2) + " s";
console.log("where the wait goes - " + replies + " replies in " + file);
console.log(pad("stage", 12) + pad("replies", 9) + pad("median", 10) + pad("p90", 10) + pad("max", 10) + "share of the median reply");
for (const r of rows) {
  const share = r.stage === "reply" || r.stage === "total" || !reply ? "" : Math.round((r.median / reply) * 100) + "%";
  console.log(pad(r.stage, 12) + pad(String(r.count), 9) + pad(sec(r.median), 10) + pad(sec(r.p90), 10) + pad(sec(r.max), 10) + share);
}
console.log("reply = from the message reaching the API to the reply leaving it; total adds filing the requests afterwards");
