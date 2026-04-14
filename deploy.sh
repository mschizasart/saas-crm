#!/bin/bash
set -e

echo "=== Deploying SaaS CRM to production ==="

# Pull latest code
git pull origin main

# Install dependencies
pnpm install --frozen-lockfile

# Run database migrations
cd apps/api
npx prisma migrate deploy
cd ../..

# Rebuild and restart containers
docker compose down
docker compose build --no-cache
docker compose up -d

echo "=== Deployment complete ==="
docker compose ps
