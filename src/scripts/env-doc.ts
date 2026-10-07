import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/** Regenerates .env.example from every process.env read in src/ - run "pnpm env:doc" after adding a variable. */
const DOC: Record<string, string> = {
  DATABASE_URL: "Postgres connection string (Supabase, ap-south-1). Migrations run against it in the build: pnpm migrate",
  ADMIN_API_KEY: "Platform key for server-to-server calls (the console's server actions, scripts, /jobs, /api/system/status). Never ships to a browser",
  ADMIN_API_KEY_PREVIOUS: "During a key rotation: the old key, still accepted until every caller is on the new one, then removed",
  JWT_SECRET: "Signs console session tokens (login, verified by tenantGuard)",
  JWT_TTL: "Console session lifetime, e.g. 7d",
  ANTHROPIC_API_KEY: "Anthropic API key - the brain. When the balance is exhausted every guest gets the fallback line and an ai_credits_exhausted alert is raised",
  ANTHROPIC_MODEL: "Main model, default claude-sonnet-4-6",
  ANTHROPIC_CHECK_MODEL: "Cheaper model that fact-checks a reply that states a fact; off to disable",
  ANTHROPIC_POLISH_MODEL: "Model that rewrites server confirmations in the guest's language; off to disable",
  ANTHROPIC_MAX_TOKENS: "Reply budget per model call, default 1200",
  ARIA_BRAIN: "agent for the tool-using brain (production); unset for the form-filling brain",
  ARIA_SCHEDULER: "on on exactly ONE instance - only that instance runs the scheduled jobs",
  META_ACCESS_TOKEN: "WhatsApp Cloud API token - must be the permanent aria-api system user token, never a personal one. Checked daily; alerts 14 days before expiry",
  META_APP_ID: "The Aria Meta app id (default 1335677035018392) - with META_APP_SECRET it lets the token's type and expiry be read",
  META_APP_SECRET: "Verifies webhook signatures from Meta, and reads the token's expiry",
  META_WABA_ID: "The production WhatsApp Business Account id (default 38265744036350087) - for listing templates: pnpm meta:check",
  META_PHONE_NUMBER_ID: "Default WhatsApp phone number id (a hotel row can override with its own)",
  META_VERIFY_TOKEN: "Shared secret for Meta's webhook verification handshake",
  META_API_VERSION: "Graph API version, default v21.0",
  META_TEMPLATE_EVENING_NUDGE: "Approved template name for the evening message; unset means text only while the 24h window is open",
  META_TEMPLATE_PRE_CHECKOUT: "Approved template name for the pre-checkout message",
  META_TEMPLATE_FEEDBACK: "Approved template name for the after-stay feedback message",
  META_TEMPLATE_REENGAGE: "Approved template sent once a day to a guest whose 24-hour window closed while a message was waiting (default aria_hello); the held message goes when they reply",
  META_TEMPLATE_LANG: "Template language code, default en",
  WELCOME_TEMPLATE: "Approved template name for the check-in welcome (guest_welcome)",
  CONSENT_GATE: "on (default): no message leaves for a guest without an opt-in on record. off disables the gate - for a test environment only, never production",
  TEST_PHONES: "Comma-separated phone numbers that are test guests - their orders and bookings are kept out of revenue",
  TEST_PHONE_PREFIXES: "Comma-separated phone prefixes (e.g. +9199999) that mark a test guest",
  OPEN_METEO_API_KEY: "Open-Meteo commercial key for live weather; unset uses the free tier",
  OPS_ALERT_EMAIL: "Comma-separated addresses that receive critical alerts (AI down, credits out, WhatsApp refusing sends, token expiring, a job failing); unset means log and banner only",
  PROACTIVE_ENABLED: "false stops all proactive messages",
  PORT: "HTTP port, default 4000 (Render sets it)",
  NODE_ENV: "production on Render",
  LOG_LEVEL: "debug, info, warn or error - default info",
  APP_BASE_URL: "Public URL of the API, used in links inside emails",
  CORS_ORIGINS: "Comma-separated console origins allowed to call the API",
  RATE_LIMIT_PER_MINUTE: "Requests per minute per caller on /api, default 120",
  LOGIN_ATTEMPTS_PER_15_MIN: "Failed logins allowed per 15 minutes before lockout",
  SESSION_INACTIVITY_HOURS: "Hours of guest silence before the are-you-still-with-us check, default 36",
  SESSION_EXPIRY_DAYS: "Days after which any session is closed, default 90",
  REQUEST_STALE_DAYS: "Days after which an untouched request is closed as expired, default 3",
  REQUEST_DEDUP_MINUTES: "Window in which a repeated ask is the same request (a chase bumps it to urgent), default 45",
  DINING_ESCALATE_MINUTES: "Minutes before an unanswered table request escalates to the GM",
  WAITLIST_HOLD_MINUTES: "Minutes a dining waitlist hold is kept before it expires",
  MESSAGE_RETENTION_DAYS: "Days messages are kept before the nightly purge removes them",
  SESSION_RETENTION_DAYS: "Days closed sessions are kept before the nightly purge removes them",
  SMTP_USER: "Mailbox that sends staff invites, confirmations and alerts - must be Globotex's own, not a developer's",
  SMTP_PASS: "App password for SMTP_USER",
  SMTP_HOST: "SMTP host; unset means Gmail",
  SMTP_PORT: "SMTP port, default 465",
  SUPABASE_URL: "Supabase project URL, for the admin client",
  SUPABASE_SERVICE_ROLE_KEY: "Supabase service-role key - server only, never in a browser",
  TEST_HOTEL_IDS: "Comma-separated hotel ids the test harness may run against; unset means all",
  AISENSY_API_URL: "Legacy AiSensy WhatsApp provider - unused when Meta direct is configured",
  AISENSY_PROJECT_ID: "Legacy AiSensy - unused",
  AISENSY_API_KEY: "Legacy AiSensy - unused",
  AISENSY_CAMPAIGN: "Legacy AiSensy - unused",
  WATI_API_URL: "Legacy WATI WhatsApp provider - unused",
  WATI_ACCESS_TOKEN: "Legacy WATI - unused",
  RENDER_GIT_COMMIT: "Set by Render; shown by /health, /api/system/status and in alerts",
};

const walk = (d: string, out: string[] = []): string[] => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) walk(f, out); else if (f.endsWith(".ts")) out.push(f); } return out; };
const names = new Set<string>();
for (const f of walk("src")) for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|process\.env\["([A-Z][A-Z0-9_]+)"\]/g)) names.add(m[1] ?? m[2]);
const lines = ["# Aria API - every environment variable the code reads. Generated by pnpm env:doc on " + new Date().toISOString().slice(0, 10) + " - do not edit by hand.", "# Copy to .env and fill in. Values are never committed.", ""];
const undocumented: string[] = [];
for (const n of [...names].sort()) { if (!DOC[n]) undocumented.push(n); lines.push("# " + (DOC[n] ?? "(undocumented - add a line to src/scripts/env-doc.ts)"), n + "=", ""); }
writeFileSync(".env.example", lines.join("\n"));
console.log(".env.example: " + names.size + " variables" + (undocumented.length ? " - UNDOCUMENTED: " + undocumented.join(", ") : ", all documented"));
