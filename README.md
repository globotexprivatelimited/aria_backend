# Aria API

The backend for Aria, the WhatsApp AI concierge for hotels. Node 20+, Express 5, TypeScript, Prisma on
Supabase Postgres, Anthropic Claude for the brain, Meta WhatsApp Cloud API for the guest channel.
The dashboard is a separate Next.js app (`aria_frontend`).

## Run from a clean clone

```bash
pnpm install
cp .env.example .env          # then fill in every value - each one is documented in the file
pnpm prisma generate
pnpm dev                      # http://localhost:4000
```

Check it is up: `GET /health` returns `{"ok":true}` and `GET /ready` reports `db:true`.

Tests and typecheck:

```bash
pnpm test                     # jest
pnpm exec tsc --noEmit
```

The dashboard (`../aria_frontend`): `pnpm install`, copy its `.env.example` to `.env`, set
`ARIA_API_URL=http://localhost:4000` and `ARIA_ADMIN_KEY` to the same value as this app's
`ADMIN_API_KEY`, then `pnpm dev` (port 3001).

## Environment variables

Every variable the code reads is listed and explained in `.env.example`. Secrets live only in
`.env` locally and in Render's environment settings in production. Never commit `.env`.

In production the server refuses to start if `ADMIN_API_KEY`, `JWT_SECRET` or `META_VERIFY_TOKEN`
is a placeholder, or if `META_APP_SECRET` is missing. The log names the offending variable.

## How a guest message flows

1. Meta posts to `POST /webhooks/meta`. The HMAC signature is verified against `META_APP_SECRET`;
   unsigned or wrong-signature posts get 401.
2. The hotel is resolved from `phone_number_id` (`Hotel.whatsapp_phone_id`).
3. `webhooks/inbound.ts`: de-duplicate by message id, store the message, then per guest, in order:
   consent notice on first contact, the safety layer (`safety/`: emergencies incl. Hindi/Bengali,
   self-harm, guest-info fishing, guest conflicts), the session gate (`session/`: only a number the
   front desk checked in may chat), a fast path for trivial replies and answers to pending offers,
   then the brain (`brain/`), the catalog (`menu/catalog.ts`: prices and availability always from
   the database) and the executor (`executor/`: creates requests, de-duplicates follow-ups).
4. Staff act from the dashboard (`/api/staff/request-action`).

## Security model

- **Guest channel**: signed webhooks only. Emergency detection runs before the model.
- **Staff**: email + bcrypt password, JWT (24h). `src/lib/security.ts#tenantGuard` locks any
  token-bearing call to the caller's own hotel; founders see all.
- **Dashboard server-to-server**: `x-admin-key`. This key is hotel-agnostic, which is why the
  dashboard must forward the user's token on data calls (open item D-005).
- **Rate limits**: 300 requests/min on `/api`, 10 failed logins per 15 minutes.
- **Supabase RLS is NOT the protection layer.** The API connects with the service-role key, which
  bypasses RLS. The RLS policies that exist are written against Supabase Auth (`auth.uid()`), which
  this app does not use, so they never match. Tenant isolation is enforced in the API. Keep the
  service-role key backend-only. (Audit D-014.)

## Runbook

**Redeploy.** Push to `main`; Render auto-deploys. Watch the log for `aria-api listening`. If it
says `Refusing to start`, a secret is a placeholder or missing.

**Rollback.** Render > Deploys > pick the previous successful deploy > Rollback. Sessions and
requests are in the database, so nothing is lost; only the in-memory processing queue restarts.

**Rotate a key.** Generate a value (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`),
set it in Render > Environment, save (Render restarts). Then:
- `JWT_SECRET`: every staff member is logged out once. No other action.
- `ADMIN_API_KEY`: set the same value as `ARIA_ADMIN_KEY` on Vercel (Production only) and redeploy the dashboard.
- `META_VERIFY_TOKEN`: re-enter it in Meta App Dashboard > WhatsApp > Configuration > Webhook, then Verify.
- `META_ACCESS_TOKEN`: generate from the `aria-api` System User in Meta Business (never a personal token).
- `META_APP_SECRET`: Meta App Dashboard > App settings > Basic.
- Database password: change in Supabase, then update `DATABASE_URL` and `DIRECT_URL` (URL-encode `@` as `%40`).
- `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `SMTP_PASS`: rotate at the provider, paste the new value.

**Add a hotel.** Today this is partly manual (self-serve onboarding is the next build):
1. Founder creates the GM login (`POST /api/admin/gms`), the GM creates the hotel (`POST /api/hotels`),
   departments (`POST /api/hotels/:hotelId/departments`) and staff (`POST /api/admin/staff`).
2. Set `Hotel.whatsapp_phone_id` to the Meta phone_number_id for that hotel's WhatsApp number.
3. Add rooms (`/api/rooms/setup`), menu and spa items (dashboard Departments page), department
   accept modes (`/api/dept-config/set`).
4. Send a test message from a real phone and confirm the reply.

**Emergency mode.** `POST /api/hotel/emergency-mode {hotelId, enabled}` (admin key). While on, every
guest message gets the emergency notice and the AI is skipped. `GET /api/hotel/settings?hotelId=` shows the state.

**Scheduled jobs** (in-process cron, need an always-on instance): retention purge 03:30 daily;
dining escalation, waitlist expiry and proactive sends every 5 minutes; self-healing hourly
(flags inactive sessions, expires 90-day sessions, closes requests not actioned in `REQUEST_STALE_DAYS`).

**Outage at 11pm.** Check Render log first (`Refusing to start`, DB errors), then Supabase status,
then Meta status. `GET /ready` says whether the database is reachable. Rollback if the last deploy
caused it. Guests are unaffected by a dashboard (Vercel) outage.
