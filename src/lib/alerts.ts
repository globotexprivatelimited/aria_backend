import nodemailer from "nodemailer";
import { log } from "./logger";
import { noteAlert } from "./status";

/**
 * Critical failures reach a person. Every alert is logged at error level and shown on the console's banner;
 * when OPS_ALERT_EMAIL is set it is also emailed - at most one email per kind every 30 minutes, so a stuck
 * job cannot flood the inbox. Kinds: brain_failed, ai_credits_exhausted, meta_rejected, meta_token_invalid,
 * meta_token_expiring, job_failed, distress_alert_failed.
 */
const WINDOW_MS = 30 * 60 * 1000;
const lastSent = new Map<string, number>();

/** True when an email for this kind is due - the first time, and then not again within the window. */
export function throttle(kind: string, now = Date.now()): boolean {
  const last = lastSent.get(kind) ?? 0;
  if (now - last < WINDOW_MS) return false;
  lastSent.set(kind, now);
  return true;
}

/** The AI running out of credit is its own kind, with its own instruction - it is the failure we have actually had. */
export function classify(kind: string, detail: string): string {
  if (kind === "brain_failed" && /credit balance|insufficient credit|billing|purchase credits/i.test(detail)) return "ai_credits_exhausted";
  return kind;
}

const ADVICE: Record<string, string> = {
  ai_credits_exhausted: "Every guest is getting the front-desk fallback line. Top up at console.anthropic.com -> Plans & Billing; no restart is needed afterwards.",
  brain_failed: "Guests are getting the front-desk fallback line while this continues. Check the Anthropic key, balance and status page.",
  meta_token_invalid: "WhatsApp sending and receiving are down. Generate the aria-api system user token in Meta Business Settings and set META_ACCESS_TOKEN on Render.",
  meta_token_expiring: "Replace META_ACCESS_TOKEN with the permanent aria-api system user token before it expires.",
  meta_rejected: "WhatsApp refused a send. The reason is in the detail; a closed 24-hour window needs an approved template, an undeliverable number should be checked at the front desk.",
  job_failed: "A scheduled job threw. Guests may miss evening and pre-checkout messages or escalations until it runs clean.",
  distress_alert_failed: "A guest wrote something that reads as distress and the staff alert could not be delivered. Go to the room now.",
};

export async function alertOps(kindIn: string, detail: string, extra: Record<string, unknown> = {}): Promise<void> {
  const kind = classify(kindIn, detail);
  log.error("ALERT " + kind, { detail, ...extra });
  noteAlert(kind, detail);
  if (!throttle(kind)) return;
  const to = (process.env.OPS_ALERT_EMAIL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!to.length || !user || !pass) return;
  try {
    const port = Number(process.env.SMTP_PORT ?? 465);
    const transport = nodemailer.createTransport(process.env.SMTP_HOST ? { host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user, pass } } : { service: "gmail", auth: { user, pass } });
    const when = new Date().toISOString();
    const text = kind + " at " + when + "\n\n" + detail + "\n\n" + (ADVICE[kind] ?? "") + (Object.keys(extra).length ? "\n\n" + JSON.stringify(extra, null, 2) : "") + "\n\nInstance: " + (process.env.RENDER_GIT_COMMIT ?? "local").slice(0, 7) + "\nNext email for this kind: not before 30 minutes from now. The console banner shows it until it clears.";
    await transport.sendMail({ from: "\"Aria alerts\" <" + user + ">", to: to.join(","), subject: "[Aria ALERT] " + kind, text });
  } catch (e) {
    log.error("alert email failed", { kind, detail: e instanceof Error ? e.message : String(e) });
  }
}
