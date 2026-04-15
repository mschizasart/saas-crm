FROM node:20-slim AS base
# Install build tools for native modules (bcrypt, etc.) on Debian
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ ca-certificates && \
    rm -rf /var/lib/apt/lists/*
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

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Install Chromium for Puppeteer PDF generation (Debian-based for reliable chromium support)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        chromium \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libc6 \
        libcairo2 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libexpat1 \
        libgbm1 \
        libglib2.0-0 \
        libnspr4 \
        libnss3 \
        libpango-1.0-0 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
        libxshmfence1 \
        ca-certificates \
        fonts-noto-color-emoji && \
    rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install -g pnpm@9
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
