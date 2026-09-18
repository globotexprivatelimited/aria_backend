# Deploying the Aria API

The API is a long-running Express server with cron jobs, so it needs a
container host - **not** Vercel (serverless, no persistent cron).

Recommended: Railway, Render, or Fly.io.

## Railway (simplest)

1. Create a new project and point it at this repo (root: `apps/api`).
2. Railway detects the Dockerfile and builds it.
3. Add the environment variables from `.env.example` - use the Supabase
   pooled URL for `DATABASE_URL` and the direct URL for `DIRECT_URL`.
4. Set `ADMIN_API_KEY` to a long random string (not the dev value).
5. Deploy. Health check path: `/ready`.

## After deploy

- In the Meta App Dashboard (WhatsApp > Configuration) set the callback URL to
  `https://<your-host>/webhooks/meta`, the verify token to `META_VERIFY_TOKEN`, and
  subscribe to the `messages` field. Set `META_APP_SECRET` so signatures verify.
- Each hotel's `Hotel.whatsapp_phone_id` must match the phone_number_id Meta sends.
- See README.md for the runbook (redeploy, rollback, rotate keys, add a hotel).
- Confirm `GET /health` returns ok and `GET /ready` reports `db: true`.

## Notes

- `/ready` returns 503 while shutting down so the platform stops routing
  traffic before in-flight guest messages finish draining.
- Migrations: run `prisma db push` (or `prisma migrate deploy` once
  migrations are introduced) against `DIRECT_URL`.
