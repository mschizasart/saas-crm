/**
 * Prisma seed entry point.
 *
 * Seeds ONE organization identified by the ORGANIZATION_ID env var so it
 * never mutates other tenants. If ORGANIZATION_ID is not set, the script
 * exits with an informative message.
 *
 * Usage:
 *   ORGANIZATION_ID=<uuid> pnpm --filter api seed
 */
import { PrismaClient } from '@prisma/client';
import { seedOrganization } from './seed-org';

const prisma = new PrismaClient();

async function main() {
  const orgId = process.env.ORGANIZATION_ID;
  if (!orgId) {
    console.error(
      '❌ ORGANIZATION_ID env var required. Aborting to avoid seeding every org.',
    );
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    console.error(`❌ Organization ${orgId} not found.`);
    process.exit(1);
  }

  console.log(`🌱 Seeding defaults for org: ${org.name} (${org.id})`);
  const result = await seedOrganization(prisma, orgId);
  console.log('✅ Done', result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
