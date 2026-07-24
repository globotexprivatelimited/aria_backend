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

- Point the Wati webhook at `https://<your-host>/webhooks/wati/<hotelWebhookToken>`.
- Point the staff/admin channel at `https://<your-host>/webhooks/admin/<hotelWebhookToken>`.
- Confirm `GET /health` returns ok and `GET /ready` reports `db: true`.

## Notes

- `/ready` returns 503 while shutting down so the platform stops routing
  traffic before in-flight guest messages finish draining.
- Migrations: run `prisma db push` (or `prisma migrate deploy` once
  migrations are introduced) against `DIRECT_URL`.
