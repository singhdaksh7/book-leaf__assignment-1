/**
 * Synthetic-data cleanup CLI. DRY-RUN BY DEFAULT: without --execute nothing is written.
 *
 *   npm run cleanup:synthetic --workspace @bookleaf/db
 *       prints exact counts, record ids and a confirmation token
 *   npm run cleanup:synthetic --workspace @bookleaf/db -- --execute --confirm <token> --backup-stamp <stamp>
 *       deletes exactly what the dry run listed (refuses if anything changed since)
 *
 * Output contains counts and opaque ids only: no emails except the explicit synthetic whitelist, no message or
 * ticket text, no attachment names or contents. ATTACHMENT_DIR (default /data/attachments in the API image) is where
 * attachment files live; they are removed only after the database transaction has committed.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { CleanupError, TABLES, deleteAttachmentFiles, executeCleanup, inspectAttachmentFiles, planCleanup, type Counts } from "../src/cleanup/index.js";
import { SYNTHETIC_AUTHOR_EMAILS } from "../src/synthetic.js";

const here = dirname(fileURLToPath(import.meta.url));
for (const envFile of [resolve(here, "..", ".env"), resolve(here, "..", "..", "..", "apps", "api", ".env")]) {
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const execute = args.includes("--execute");
const json = args.includes("--json");

function fail(message: string, code = 1): never {
  console.error(`cleanup: ${message}`);
  process.exit(code);
}

const table = (rows: Array<[string, ...Array<string | number>]>, header: string[]) => {
  const all = [header, ...rows.map((r) => r.map(String))];
  const widths = header.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  for (const r of all) console.log("  " + r.map((c, i) => c.padEnd(widths[i]!)).join("  "));
};
const countRows = (a: Counts, b: Counts, c: Counts): Array<[string, number, number, number]> => TABLES.map((t) => [t, a[t], b[t], c[t]]);

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set");
  const attachmentDir = resolve(process.env.ATTACHMENT_DIR ?? "/data/attachments");
  const prisma = new PrismaClient();
  try {
    const plan = await planCleanup(prisma);
    const files = await inspectAttachmentFiles(prisma, attachmentDir, plan.attachmentKeys);

    if (json) {
      console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", ...plan, attachmentKeys: undefined, attachmentKeyCount: plan.attachmentKeys.length, files }, null, 2));
    } else {
      console.log(`cleanup: ${execute ? "EXECUTE" : "DRY RUN (nothing will be changed)"}`);
      console.log(`\nWhitelisted synthetic identities (${SYNTHETIC_AUTHOR_EMAILS.length}): ${SYNTHETIC_AUTHOR_EMAILS.join(", ")}`);
      console.log(`Protected admin accounts (never deleted): ${plan.protectedAdminIds.length} -> ${plan.protectedAdminIds.join(", ") || "none"}`);
      console.log("\nRows per table:");
      table(countRows(plan.totals, plan.toDelete, plan.expectedAfter), ["table", "today", "delete", "remain"]);
      console.log(`\nSynthetic users to delete (${plan.userIds.length}): ${plan.userIds.join(" ")}`);
      console.log(`Author profiles (${plan.profileIds.length}): ${plan.profileIds.join(" ")}`);
      console.log(`Books (${plan.bookIds.length}): ${plan.bookIds.join(" ")}`);
      console.log(`Tickets (${plan.ticketIds.length}): ${plan.ticketIds.join(" ")}`);
      console.log(`\nAttachment files: ${plan.attachmentKeys.length} referenced by rows to delete; present ${files.present}, missing ${files.missing}` +
        (files.directoryReadable ? `; unreferenced files in the directory (reported only, never deleted): ${files.unreferencedFiles}` : "; storage directory not readable from here"));
      console.log(`Audit log: never deleted. ${plan.totals.auditLogs} rows stay; ${plan.auditRowsActorNulled} of them lose only their actor id (ON DELETE SET NULL, permitted by the append-only trigger).`);
      if (plan.excluded.length) {
        console.log("\nExcluded (whitelisted email but not provably synthetic; left untouched):");
        for (const e of plan.excluded) console.log(`  ${e.userId}: ${e.reason}`);
      }
      if (plan.blockers.length) {
        console.log("\nBLOCKERS (execution is refused until resolved):");
        for (const b of plan.blockers) console.log(`  - ${b}`);
      }
      console.log(`\nConfirmation token: ${plan.token}`);
    }

    if (!execute) {
      if (plan.blockers.length) process.exit(2);
      if (!json) console.log(`\nTo execute after approval and a verified backup:\n  npm run cleanup:synthetic --workspace @bookleaf/db -- --execute --confirm ${plan.token} --backup-stamp <YYYYMMDDTHHMMSSZ>`);
      return;
    }

    const confirm = flag("--confirm");
    const backupStamp = flag("--backup-stamp");
    if (!confirm || !backupStamp) fail("--execute needs --confirm <token> and --backup-stamp <stamp>");
    const result = await executeCleanup(prisma, { confirm, backupStamp });
    const removed = await deleteAttachmentFiles(attachmentDir, plan.attachmentKeys);
    const remaining = await inspectAttachmentFiles(prisma, attachmentDir, []);
    console.log("\ncleanup: committed and verified inside the transaction.");
    table(countRows(result.before, result.deleted, result.after), ["table", "before", "deleted", "after"]);
    console.log(`Attachment files removed: ${removed.removed}; unreferenced files left in the directory: ${remaining.unreferencedFiles}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof CleanupError) fail(error.message, 2);
  fail(`unexpected failure (${error instanceof Error ? error.name : "unknown"})`);
});
