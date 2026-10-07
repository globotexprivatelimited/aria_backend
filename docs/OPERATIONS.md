# Aria API - operations

## Where things run
- Production: Render service aria-backend-woop (Globotex account), deploys from globotexprivatelimited/aria_backend main.
  Build command: pnpm install && pnpm build && pnpm migrate. Start: node dist/server.js. Env ARIA_SCHEDULER=on here and nowhere else.
- Staging: render.yaml defines aria-api-staging from the staging branch with its own database, AI key and WhatsApp number.
  Work flows branch -> pull request (CI runs the suite against a throwaway Postgres) -> staging -> main.
- Database: Supabase project nxdmxdgfggojjfnbcyse (ap-south-1). Schema changes are files in migrations/, applied once each by pnpm migrate.

## When something breaks
- GET /health shows the running commit. GET /api/system/status (x-admin-key) shows: is the AI answering, is WhatsApp sending,
  when each scheduled job last ran, the token's type and expiry, and the last 20 alerts. The console shows the same as a banner.
- Alerts (src/lib/alerts.ts) are logged as "ALERT <kind>" and emailed to OPS_ALERT_EMAIL, one email per kind per 30 minutes.
  Kinds: ai_credits_exhausted, brain_failed, meta_rejected, meta_token_invalid, meta_token_expiring, job_failed, distress_alert_failed.
- The AI is down (ai_credits_exhausted / brain_failed): every guest gets the front-desk fallback line and the GM is alerted per message.
  Top up at console.anthropic.com -> Plans & Billing. No restart or redeploy is needed; the next message works.
- WhatsApp token invalid or expiring: Meta Business Settings -> System users -> aria-api -> Generate token (whatsapp_business_messaging,
  whatsapp_business_management, never expires) -> set META_ACCESS_TOKEN on Render -> pnpm meta:check shows type SYSTEM_USER, expires never.
- Scheduled jobs not running: check ARIA_SCHEDULER=on on exactly one instance, or that the Render cron jobs are calling /jobs/*.
  Any job can be run by hand: POST /jobs/every-5-min | hourly | daily with x-admin-key.

## Rotating the platform key
1. Set ADMIN_API_KEY_PREVIOUS = the current key and ADMIN_API_KEY = the new key on Render; the API accepts both.
2. Update ARIA_ADMIN_KEY on Vercel (Production only - never Preview) and on every cron job; redeploy the console.
3. Remove ADMIN_API_KEY_PREVIOUS. The old key is now rejected. Rehearse on staging first.

## Rotating the database password
Supabase -> Project Settings -> Database -> Reset database password; update DATABASE_URL on Render (production and staging) and in
every developer .env; redeploy. Any forgotten copy of the backend loses its connection at that moment, which is the point.

## Backups
Supabase Pro gives daily backups and point-in-time recovery. Restore drill: restore to a NEW project, point a staging service at it,
run pnpm latency and open the console against it, write the date and the time taken into this file.

## Webhook requests blocked at the edge
Render's edge (Cloudflare) can answer a webhook POST with "403 Blocked" when the guest's text looks like an injection payload; Meta retries
into the same block and the guest gets silence. There is no server-side fix: ask Render support to exempt /webhooks/meta from managed WAF
rules for the service, or, once the API is on a custom domain behind Globotex's own Cloudflare, add a WAF skip rule for that path
limited to Meta's published IP ranges.

## Useful scripts
- pnpm meta:check      - token type and expiry, number quality, every template and its status against the configured names
- pnpm latency [hotel] - median and p90 reply time from the database
- pnpm env:doc         - regenerate .env.example from the code
- pnpm migrate:dev     - apply pending migrations to the database in .env
