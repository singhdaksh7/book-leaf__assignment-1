/**
 * Seed CLI. Reads a local dataset at runtime; never bundles, logs or copies records. Prints aggregate counts only.
 *
 *   npm run seed --workspace @bookleaf/db              # original dataset (BOOKLEAF_SEED_DATA_PATH or data/bookleaf_sample_data.json)
 *   npm run seed:synthetic --workspace @bookleaf/db    # data/synthetic_seed.json (entirely synthetic demo data)
 *
 * Credentials come from the environment, never the dataset: BOOKLEAF_SEED_AUTHOR_PASSWORD (required),
 * BOOKLEAF_SEED_ADMIN_EMAIL / BOOKLEAF_SEED_ADMIN_PASSWORD (optional pair), BOOKLEAF_SEED_RESET_PASSWORDS=1 (explicit).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { importSeedData, parseSeedDataset, SeedConflictError, SeedValidationError } from "../src/seed/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const synthetic = process.argv.includes("--synthetic");

function fail(message: string, details: string[] = []): never {
  console.error(`seed: ${message}`);
  for (const line of details) console.error(`  - ${line}`);
  process.exit(1);
}

for (const envFile of [resolve(here, "..", ".env"), resolve(repoRoot, "apps", "api", ".env")]) {
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

function resolveDataPath(): string {
  if (synthetic) return resolve(repoRoot, "data", "synthetic_seed.json");
  const configured = process.env.BOOKLEAF_SEED_DATA_PATH;
  if (configured) return isAbsolute(configured) ? configured : resolve(repoRoot, configured);
  return resolve(repoRoot, "data", "bookleaf_sample_data.json");
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set");
  const authorPassword = process.env.BOOKLEAF_SEED_AUTHOR_PASSWORD;
  if (!authorPassword) fail("BOOKLEAF_SEED_AUTHOR_PASSWORD is not set (credentials are configured separately from the dataset)");

  const dataPath = resolveDataPath();
  if (!existsSync(dataPath)) {
    fail(synthetic
      ? "Synthetic fixture data/synthetic_seed.json is missing"
      : "Seed dataset not found. Place the confidential file at data/bookleaf_sample_data.json (ignored by git), set BOOKLEAF_SEED_DATA_PATH, or run the synthetic demo seed: npm run seed:synthetic --workspace @bookleaf/db");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(dataPath, "utf8"));
  } catch {
    fail("Seed file is not valid JSON");
  }
  const dataset = parseSeedDataset(raw);
  const bookCount = dataset.reduce((total, author) => total + author.books.length, 0);

  const prisma = new PrismaClient();
  try {
    const summary = await importSeedData(prisma, dataset, {
      credentials: {
        authorPassword,
        adminEmail: process.env.BOOKLEAF_SEED_ADMIN_EMAIL || undefined,
        adminPassword: process.env.BOOKLEAF_SEED_ADMIN_PASSWORD || undefined,
        resetPasswords: process.env.BOOKLEAF_SEED_RESET_PASSWORDS === "1"
      }
    });
    console.log(`seed: ${synthetic ? "synthetic" : "local"} dataset OK - ${summary.authors} authors, ${summary.books} books upserted; ` +
      `${summary.usersCreated} author logins created, admin ${summary.adminCreated ? "created" : "unchanged/not configured"}, ${summary.passwordsReset} passwords reset`);
    if (!synthetic && (dataset.length !== 10 || bookCount !== 18)) {
      console.warn(`seed: warning - expected 10 authors / 18 books for the original dataset, found ${dataset.length} / ${bookCount}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof SeedValidationError) fail(error.message, error.issues);
  if (error instanceof SeedConflictError) fail(error.message);
  // Do not print the raw error: database errors can echo row values.
  fail(`unexpected failure (${error instanceof Error ? error.name : "unknown"})`);
});
