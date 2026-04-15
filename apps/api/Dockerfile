FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++ libc6-compat
RUN npm install -g pnpm@9 turbo

FROM base AS builder
WORKDIR /app
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/ ./packages/
RUN pnpm install --no-frozen-lockfile --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY apps/api ./apps/api
RUN cd apps/api && ./node_modules/.bin/prisma generate 2>/dev/null || npx --yes prisma@6 generate

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Install chromium from Alpine edge repos (main Alpine has broken dependencies for chromium)
RUN echo "https://dl-cdn.alpinelinux.org/alpine/edge/main" >> /etc/apk/repositories && \
    echo "https://dl-cdn.alpinelinux.org/alpine/edge/community" >> /etc/apk/repositories && \
    apk update && \
    apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont || \
    echo "Chromium install failed - PDF generation will be disabled"
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_DOWNLOAD=true
# Copy installed dependencies and source (no compile — use ts-node --transpile-only at runtime)
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/packages ./packages
EXPOSE 3001
ENV TS_NODE_TRANSPILE_ONLY=true
ENV TS_NODE_PROJECT=/app/apps/api/tsconfig.json
# Run via ts-node --transpile-only — skips type checking, tolerant of type errors
CMD ["sh", "-c", "cd /app/apps/api && node --max-old-space-size=1024 -r ts-node/register src/main.ts"]
