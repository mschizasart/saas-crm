FROM node:20-alpine AS base
RUN npm install -g pnpm
WORKDIR /app

# ─── Development ─────────────────────────────────────────────
FROM base AS development
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY prisma/ ./prisma/
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 3001
CMD ["pnpm", "--filter", "api", "dev"]

# ─── Builder ─────────────────────────────────────────────────
FROM base AS builder
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY prisma/ ./prisma/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter api build
RUN pnpm --filter api prisma generate

# ─── Production ──────────────────────────────────────────────
FROM node:20-alpine AS production
RUN npm install -g pnpm
WORKDIR /app
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
EXPOSE 3001
CMD ["node", "apps/api/dist/main"]
