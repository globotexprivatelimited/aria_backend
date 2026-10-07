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

## Settings, forms and the offer log

- Quiet hours, the evening nudge window and the upsell limits are per hotel (table hotel_settings, console Settings). The code's defaults apply until a hotel saves its own: 21:30-08:00 quiet, 17:00-21:00 nudges, at most 2 offers a day, 3 hours apart. A change is live within a minute.
- Department hours (table dept_hours) are read into every prompt with OPEN/CLOSED now; the agent is told not to order or book with a closed department and to say when it opens.
- Knowledge base forms: Form 1 hotel essentials (hotel_profile), Form 4 spa rules (spa_rules), Form 5 services and prices (hotel_services). GET /api/forms/go-live lists the mandatory fields still empty; POST /api/forms/go-live marks the hotel onboarded only when all six are filled.
- Upselling: the code chooses the item (pairings first, then the moment), logs it in offers as proposed, marks it offered or skipped once the reply is sent, accepted when an order contains it (revenue = price x quantity) and declined after 24 hours. GET /api/revenue/offers is the revenue-from-suggestions report; test guests are left out.
- A hotel's own WhatsApp number: POST /api/founder/hotels/:hotelId/whatsapp with the phone-number id (and WABA id) checks it with Meta, saves it on the hotel row and subscribes the app to the WABA. Founder console: hotel page, WhatsApp card.

## Load test

- `pnpm loadtest --hotel <id>` starts its own copy of the API on port 4999 with META_SEND=off (nothing can reach WhatsApp), a throwaway webhook secret and the scheduler off, then plays guests through the signed webhook from fictional +1 xxx 555-01xx numbers: A 20 guests at once (U04), B a peak of 50 messages in five minutes (U05), C multi-question messages (U03).
- It prints acks, messages processed, questions answered, reply time p50/p90/max, ordering errors, fallback replies, and the server's memory, CPU and event-loop lag (also on /api/system/status as `process`). PASS means no drops, no timeouts and no ordering errors. A JSON report goes to loadtest-reports/.
- The AI is called for real (about 115 replies for a full run). Every row the run creates is deleted at the end; `--keep` leaves them and `pnpm loadtest --cleanup` removes them later.
- META_SEND=off also suits a staging copy that points at the production database.
- Guests are checked in first through the copy's own /api/checkin (rooms 92xx/93xx/94xx, no opt-in, stay reminders cancelled); --prospects plays strangers instead. The copy's log is saved beside the report, and the run prints Aria's most common replies and how many replies the server suppressed as duplicates.
- Every scenario waits for its last answer (or the --timeout) before it is scored. The privacy notice each new guest gets on first contact is counted on its own line and never taken for an answer. A multi-question message (scenario C) that leaves a question out fails the run and names the question. Reply times are measured from the machine running the test, so on a laptop they include its round trips to Supabase and the AI service.
- DATABASE_URL should end with connection_limit=15&pool_timeout=20 after pgbouncer=true. Without it Prisma sizes its pool from the CPU count and, with 20 guests writing at once, queries wait for a connection: setting it took the load test's median reply from 24.7 s to 12.7 s and the privacy notice from 10.8 s to 5.9 s. A run also shows how many answers mention what was asked (on topic) and warns with examples when some do not.
