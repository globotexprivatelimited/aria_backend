FROM node:22-slim AS base
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma
RUN pnpm install --prod=false

COPY . .
RUN pnpm exec prisma generate
RUN pnpm exec tsc

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/server.js"]
