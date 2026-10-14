import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const here = dirname(fileURLToPath(import.meta.url));
const dbPackageDir = resolve(here, "..", "..", "..", "packages", "db");

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolvePort(port));
    });
  });
}

function migrate(databaseUrl: string): void {
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: dbPackageDir, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe"
  });
}

/**
 * Tests need a real PostgreSQL (constraints, triggers and Prisma behaviour matter). Set TEST_DATABASE_URL to use your own
 * server (its database name must contain "test" because tests truncate tables); otherwise a throwaway embedded
 * PostgreSQL is started in a temp directory and removed afterwards.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const provided = process.env.TEST_DATABASE_URL;
  if (provided) {
    const name = new URL(provided).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error("TEST_DATABASE_URL database name must contain 'test'; tests truncate all tables");
    process.env.DATABASE_URL = provided;
    migrate(provided);
    return async () => {};
  }

  const dir = mkdtempSync(join(tmpdir(), "bookleaf-pg-"));
  const port = await freePort();
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "bookleaf", password: "bookleaf", port, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("bookleaf_test");
  const url = `postgresql://bookleaf:bookleaf@127.0.0.1:${port}/bookleaf_test?schema=public`;
  process.env.DATABASE_URL = url;
  migrate(url);

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
