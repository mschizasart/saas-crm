/**
 * Create the first platform admin account.
 *
 * Usage:
 *   EMAIL=admin@example.com PASSWORD=mypass NAME="Master Admin" \
 *     ts-node scripts/create-platform-admin.ts
 *
 * Or interactively:
 *   ts-node scripts/create-platform-admin.ts
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as readline from 'readline';

const prisma = new PrismaClient();

async function ask(q: string, hide = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(q, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}

async function main() {
  let email = process.env.EMAIL ?? '';
  let password = process.env.PASSWORD ?? '';
  let name = process.env.NAME ?? '';

  if (!email) email = await ask('Email: ');
  if (!name) name = await ask('Name: ');
  if (!password) password = await ask('Password: ');

  if (!email || !password || !name) {
    console.error('Email, password, and name are required');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const existing = await prisma.platformAdmin.findUnique({ where: { email } });
  if (existing) {
    console.log(`Platform admin ${email} already exists. Updating password...`);
    const hash = await bcrypt.hash(password, 12);
    await prisma.platformAdmin.update({
      where: { email },
      data: { password: hash, name },
    });
    console.log(`✓ Platform admin password updated for ${email}`);
  } else {
    const hash = await bcrypt.hash(password, 12);
    const admin = await prisma.platformAdmin.create({
      data: { email, password: hash, name },
    });
    console.log(`✓ Platform admin created: ${admin.email} (id=${admin.id})`);
  }

  console.log(`\nLogin at: https://your-domain/platform/login`);
  console.log(`API endpoint: POST /api/v1/platform/login`);
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
