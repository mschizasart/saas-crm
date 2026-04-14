# SaaS CRM

Modern multi-tenant CRM — a full rewrite of Perfex CRM as a SaaS platform.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | NestJS (Node.js + TypeScript) |
| Database | PostgreSQL 16 with Row-Level Security |
| ORM | Prisma |
| Frontend | Next.js 14 (App Router) |
| UI | shadcn/ui + Tailwind CSS |
| Auth | NextAuth.js v5 + Passport JWT |
| Real-time | Socket.io via NestJS Gateway |
| Queue | BullMQ + Redis |
| Storage | MinIO (S3-compatible) |
| Email | Nodemailer + React Email |
| PDF | Puppeteer |
| Billing | Stripe |
| Containers | Docker + Docker Compose |

## Prerequisites

- Node.js 20+ (install via nvm: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`)
- pnpm (`npm install -g pnpm`)
- Docker + Docker Compose

## Quick Start

```bash
# 1. Clone and install
cd saas-crm
cp .env.example .env
# Edit .env with your Stripe keys, OAuth credentials, etc.

pnpm install

# 2. Start the infrastructure (PostgreSQL, Redis, MinIO)
docker compose up -d postgres redis minio

# 3. Run database migrations
cd apps/api
./node_modules/.bin/prisma migrate dev --name init
./node_modules/.bin/prisma generate

# 4. Apply Row-Level Security policies
cd ../..
./scripts/apply-rls.sh

# 5. Start the development servers
pnpm dev
```

The app will be available at:
- **Web (Next.js):** http://localhost:3000
- **API (NestJS):** http://localhost:3001/api
- **API Docs (Swagger):** http://localhost:3001/api/docs
- **BullMQ Dashboard:** http://localhost:3002
- **MinIO Console:** http://localhost:9001

## Project Structure

```
saas-crm/
├── apps/
│   ├── api/          # NestJS backend
│   └── web/          # Next.js 14 frontend
├── packages/
│   ├── shared-types/ # TypeScript types shared between api and web
│   └── email-templates/ # React Email templates
├── prisma/           # Database schema (source of truth)
├── docker/           # Dockerfiles and nginx config
├── scripts/          # ETL migration and utility scripts
└── docker-compose.yml
```

## Multi-tenancy

Each organization (tenant) is isolated using PostgreSQL Row-Level Security:
- Subdomain routing: `acme.yoursaas.com`
- Custom domain support
- JWT claims include `organizationId`

## Migration from Perfex CRM

See `scripts/migrate-from-perfex.ts` for the ETL migration script skeleton.

## Implementation Phases

- **Phase 1** (current): Foundation — auth, organizations, users, roles, billing
- **Phase 2**: Sales core — clients, leads, invoices, payments
- **Phase 3**: Projects + tasks
- **Phase 4**: Support + knowledge base
- **Phase 5**: Contracts, estimates, proposals
- **Phase 6**: Notifications, custom fields, reports
- **Phase 7**: Modules — surveys, goals, GDPR, exports

## Production Deployment

```bash
# Build and start production stack
cp .env.example .env.production
# Edit .env.production with production values

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```
