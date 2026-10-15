#!/usr/bin/env node
/**
 * Compiles a committed revision of packages/ai from another worktree/branch into apps/api/.tmp/ai-dist so the backend's
 * real-package integration test can run before `agent/ai` is merged. Read-only for the source repository (git archive),
 * writes only under apps/api/.tmp (git-ignored). Usage:
 *   node apps/api/scripts/build-ai-from-git.mjs <path-to-ai-worktree> [ref=HEAD]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [repo, ref = "HEAD"] = process.argv.slice(2);
if (!repo) {
  console.error("usage: node build-ai-from-git.mjs <path-to-ai-worktree> [ref]");
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const tmp = resolve(here, "..", ".tmp");
const src = join(tmp, "ai-src");
const out = join(tmp, "ai-dist");
rmSync(src, { recursive: true, force: true });
rmSync(out, { recursive: true, force: true });
mkdirSync(src, { recursive: true });
mkdirSync(out, { recursive: true });

const tarFile = join(tmp, "ai-src.tar");
execFileSync("git", ["-C", repo, "archive", "--format=tar", `--output=${tarFile}`, ref, "packages/ai/src"], { stdio: "inherit" });
// Relative paths and cwd: GNU tar would read "C:" in an absolute Windows path as a remote host.
execFileSync("tar", ["-xf", "ai-src.tar", "-C", "ai-src"], { cwd: tmp, stdio: "inherit" });
rmSync(tarFile, { force: true });

const pkg = join(src, "packages", "ai");
writeFileSync(join(pkg, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, esModuleInterop: true,
    noUncheckedIndexedAccess: true, outDir: out, rootDir: join(pkg, "src"), types: ["node"]
  },
  include: ["src/**/*.ts"]
}, null, 2));
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "-p", join(pkg, "tsconfig.json")], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
const sha = execFileSync("git", ["-C", repo, "rev-parse", "--short", ref], { encoding: "utf8" }).trim();
writeFileSync(join(out, ".source-ref"), sha);
console.log(`built @bookleaf/ai@${sha} -> ${out}`);
