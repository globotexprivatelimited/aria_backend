import { jobStarted, jobFinished } from "./lifecycle";
import { log } from "./logger";

type Job = () => Promise<void>;

const chains = new Map<string, Promise<void>>();

export function enqueue(key: string, job: Job): void {
  const prev = chains.get(key) ?? Promise.resolve();
  jobStarted();
  const next = prev
    .then(job)
    .catch((err) => {
      log.error("queue job failed", { key, detail: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => {
      jobFinished();
    });
  chains.set(key, next);
  void next.finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
}

export function queueDepth(): number {
  return chains.size;
}
