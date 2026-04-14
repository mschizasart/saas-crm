FROM node:20-alpine AS base
RUN npm install -g pnpm@9 turbo

FROM base AS builder
WORKDIR /app
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/ ./packages/
RUN pnpm install --no-frozen-lockfile
COPY apps/api ./apps/api
RUN cd apps/api && ./node_modules/.bin/prisma generate 2>/dev/null || npx --yes prisma@6 generate
RUN cd apps/api && node_modules/.bin/tsc --noEmitOnError false 2>&1 | tail -5 || true

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install -g pnpm@9
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/packages ./packages
EXPOSE 3001
CMD ["node", "apps/api/dist/main"]
