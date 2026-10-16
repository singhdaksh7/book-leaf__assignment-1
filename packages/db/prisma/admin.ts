/**
 * Admin CLI: create the administrator, or rotate its password.
 *
 *   BOOKLEAF_ADMIN_EMAIL=... BOOKLEAF_ADMIN_PASSWORD=... npm run admin:ensure --workspace @bookleaf/db
 *   ... npm run admin:ensure --workspace @bookleaf/db -- --rotate-password
 *
 * The password is read from the environment only (never argv, so it does not land in shell history or process lists)
 * and is never printed.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { AdminError, ensureAdmin } from "../src/admin/index.js";

const here = dirname(fileURLToPath(import.meta.url));
for (const envFile of [resolve(here, "..", ".env"), resolve(here, "..", "..", "..", "apps", "api", ".env")]) {
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

function fail(message: string): never {
  console.error(`admin: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set");
  const email = process.env.BOOKLEAF_ADMIN_EMAIL;
  const password = process.env.BOOKLEAF_ADMIN_PASSWORD;
  if (!email || !password) fail("set BOOKLEAF_ADMIN_EMAIL and BOOKLEAF_ADMIN_PASSWORD in the environment");
  const prisma = new PrismaClient();
  try {
    const result = await ensureAdmin(prisma, { email, password, rotatePassword: process.argv.includes("--rotate-password") });
    console.log(`admin: ${result.action} (user ${result.userId}); sessions revoked: ${result.sessionsRevoked}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof AdminError) fail(error.message);
  fail(`unexpected failure (${error instanceof Error ? error.name : "unknown"})`);
});
