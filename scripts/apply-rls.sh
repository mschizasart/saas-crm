#!/bin/bash
# Apply RLS policies after Prisma migrations
# Usage: ./scripts/apply-rls.sh

set -e

if [ -z "$DATABASE_URL" ]; then
  source .env 2>/dev/null || true
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

echo "Applying RLS policies..."
psql "$DATABASE_URL" -f apps/api/prisma/rls-policies.sql 2>&1

if [ $? -eq 0 ]; then
  echo "✅ RLS policies applied successfully"
else
  echo "❌ Failed to apply RLS policies"
  exit 1
fi
