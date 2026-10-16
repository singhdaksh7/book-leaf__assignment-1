// Disposable full stack for the Playwright suite. Started by Playwright's `webServer`; nothing here touches real data.
//
//   embedded PostgreSQL (temp dir, random port) -> prisma migrate deploy -> synthetic seed
//   mock OpenRouter (local HTTP, records every request, never leaves the machine)
//   API  (apps/api/dist/server.js, built)  on E2E_API_PORT (default 3100)
//   Web  (vite build with VITE_API_BASE_URL -> API, then vite preview) on E2E_WEB_PORT (default 5180)
//
// Prerequisite: `npm run build` at the repository root (the API, @bookleaf/db and @bookleaf/ai are run from dist).
// Runtime coordinates for the tests are written to node_modules/.cache/bookleaf-e2e/runtime.json (git-ignored).
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, "..");
const root = resolve(webDir, "..", "..");
const require = createRequire(join(root, "package.json"));

const API_PORT = Number(process.env.E2E_API_PORT ?? 3100);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5180);
const HOST = "127.0.0.1";
const API_ORIGIN = `http://${HOST}:${API_PORT}`;
const WEB_ORIGIN = `http://${HOST}:${WEB_PORT}`;

// Synthetic credentials for this disposable stack only.
const CREDENTIALS = {
  authorPassword: "e2e-author-Passw0rd!",
  adminEmail: "e2e.admin@example.test",
  adminPassword: "e2e-admin-Passw0rd!"
};
const AI_KEY = "sk-or-e2e-0000000000000000"; // fake; the mock server never validates it
const SESSION_SECRET = "e2e-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz";

const runtimeDir = join(root, "node_modules", ".cache", "bookleaf-e2e");
const runtimeFile = join(runtimeDir, "runtime.json");
const children = [];
const cleanups = [];

function log(message) {
  process.stdout.write(`[e2e-stack] ${message}\n`);
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function waitFor(url, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`${label} did not become ready at ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

function sweepStaleDirs() {
  // A force-killed previous run (Windows) cannot clean up after itself.
  for (const name of readdirSync(tmpdir())) {
    if (!/^bookleaf-e2e-/.test(name)) continue;
    const path = join(tmpdir(), name);
    try {
      if (Date.now() - statSync(path).mtimeMs > 10 * 60_000) rmSync(path, { recursive: true, force: true });
    } catch {
      // still in use or already gone
    }
  }
}

// --- Mock OpenRouter -----------------------------------------------------------------------------------------------
const CLASSIFICATION = { category: "ROYALTY_PAYMENTS", priority: "HIGH", confidence: 0.9, rationale: "The author asks about unpaid royalties.", citations: ["kb.royalty-policy"] };
const DRAFT_BODY = "I'm sorry you have waited 4 months without a clear answer, and I understand the frustration. Royalties are calculated quarterly and paid within 45 days of the quarter ending, by bank transfer to the account linked in your dashboard. Our team will verify the royalty figures for your book against our internal records and follow up with you. Please check that your bank details are linked in your dashboard.";
const DRAFT = { draft: `Dear {{authorFirstName}},\n\n${DRAFT_BODY}\n\nWarm regards,\nBookLeaf Author Support`, citations: ["kb.royalty-policy"] };
const envelope = (content) => ({ choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 400, completion_tokens: 50, total_tokens: 450, cost: 0.00009 } });

function startMockOpenRouter() {
  const requests = [];
  let mode = "ok"; // "ok" | "error"
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const send = (status, payload) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
      if (req.url === "/__control/requests") return send(200, requests);
      if (req.url === "/__control/reset") { requests.length = 0; mode = "ok"; return send(200, { ok: true }); }
      if (req.url === "/__control/shutdown") { send(200, { ok: true }); setTimeout(() => void shutdown(0), 50); return; }
      if (req.url === "/__control/mode") { mode = JSON.parse(body || "{}").mode === "error" ? "error" : "ok"; return send(200, { mode }); }
      if (req.url?.endsWith("/chat/completions")) {
        const parsed = JSON.parse(body || "{}");
        requests.push({ authorization: req.headers.authorization ?? null, body: parsed });
        if (mode === "error") return send(500, { error: { code: 500 } });
        const system = parsed.messages?.[0]?.content ?? "";
        const isClassify = system.includes("triage support tickets");
        return send(200, envelope(JSON.stringify(isClassify ? CLASSIFICATION : DRAFT)));
      }
      return send(404, {});
    });
  });
  return new Promise((resolveMock) => {
    server.listen(0, HOST, () => {
      cleanups.push(() => new Promise((done) => { server.closeAllConnections(); server.close(() => done()); }));
      resolveMock(`http://${HOST}:${server.address().port}`);
    });
  });
}

// --- Process helpers -----------------------------------------------------------------------------------------------
function run(label, args, options) {
  log(label);
  execFileSync(process.execPath, args, { stdio: ["ignore", "ignore", "inherit"], ...options });
}

function spawnChild(label, args, options) {
  const child = spawn(process.execPath, args, { stdio: ["ignore", "inherit", "inherit"], ...options });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      log(`${label} exited unexpectedly (code=${code} signal=${signal})`);
      void shutdown(1);
    }
  });
  return child;
}

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down");
  for (const child of [...children].reverse()) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  await Promise.race([
    Promise.all(children.map((c) => new Promise((r) => (c.exitCode !== null ? r() : c.once("exit", r))))),
    new Promise((r) => setTimeout(r, 12_000))
  ]);
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  for (const cleanup of cleanups.reverse()) {
    try { await cleanup(); } catch (error) { log(`cleanup failed: ${error?.name ?? "error"}`); }
  }
  rmSync(runtimeFile, { force: true });
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

// --- Main ----------------------------------------------------------------------------------------------------------
async function main() {
  for (const needed of ["apps/api/dist/server.js", "packages/db/dist/index.js", "packages/ai/dist/index.js"]) {
    if (!existsSync(join(root, needed))) throw new Error(`${needed} is missing. Run "npm run build" at the repository root first.`);
  }
  sweepStaleDirs();
  mkdirSync(runtimeDir, { recursive: true });
  rmSync(runtimeFile, { force: true });

  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const workDir = mkdtempSync(join(tmpdir(), "bookleaf-e2e-"));
  cleanups.push(async () => rmSync(workDir, { recursive: true, force: true }));
  const pgPort = await freePort();
  const pg = new EmbeddedPostgres({ databaseDir: join(workDir, "pg"), user: "bookleaf", password: "bookleaf", port: pgPort, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  log(`starting disposable PostgreSQL on port ${pgPort}`);
  await pg.initialise();
  await pg.start();
  cleanups.push(() => pg.stop());
  await pg.createDatabase("bookleaf_e2e");
  const databaseUrl = `postgresql://bookleaf:bookleaf@${HOST}:${pgPort}/bookleaf_e2e?schema=public`;

  const dbDir = join(root, "packages", "db");
  const dbEnv = { ...process.env, DATABASE_URL: databaseUrl };
  run("applying migrations", [require.resolve("prisma/build/index.js"), "migrate", "deploy"], { cwd: dbDir, env: dbEnv });
  run("seeding synthetic data", [require.resolve("tsx/cli"), "prisma/seed.ts", "--synthetic"], {
    cwd: dbDir,
    env: { ...dbEnv, BOOKLEAF_SEED_AUTHOR_PASSWORD: CREDENTIALS.authorPassword, BOOKLEAF_SEED_ADMIN_EMAIL: CREDENTIALS.adminEmail, BOOKLEAF_SEED_ADMIN_PASSWORD: CREDENTIALS.adminPassword }
  });

  const mockUrl = await startMockOpenRouter();
  const attachmentDir = join(workDir, "attachments");

  const apiEnv = {
    ...process.env, NODE_ENV: "development", PORT: String(API_PORT), DATABASE_URL: databaseUrl, SESSION_SECRET, WEB_ORIGIN, ATTACHMENT_DIR: attachmentDir,
    OPENROUTER_API_KEY: AI_KEY, OPENROUTER_BASE_URL: mockUrl, OPENROUTER_MODEL: "e2e/mock-model", AI_TIMEOUT_MS: "5000", AI_MAX_RETRIES: "0",
    // Generous ceilings: the suite logs in many times and creates tickets from one IP.
    TICKET_CREATE_LIMIT_PER_HOUR: "500", AUTHOR_REPLY_LIMIT_PER_HOUR: "500", LOGIN_MAX_FAILURES: "100",
    REGISTER_LIMIT_PER_IP_PER_HOUR: "500", REGISTER_LIMIT_GLOBAL_PER_HOUR: "1000"
  };
  spawnChild("api", [join(root, "apps", "api", "dist", "server.js")], { cwd: join(root, "apps", "api"), env: apiEnv });
  await waitFor(`${API_ORIGIN}/healthz`, "API");

  const webOut = join(workDir, "web-dist");
  const viteCli = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
  run("building web bundle for the e2e API", [viteCli, "build", "--outDir", webOut, "--emptyOutDir"], { cwd: webDir, env: { ...process.env, VITE_API_BASE_URL: `${API_ORIGIN}/api/v1`, VITE_USE_MOCKS: "false" } });
  spawnChild("web", [viteCli, "preview", "--outDir", webOut, "--host", HOST, "--port", String(WEB_PORT), "--strictPort"], { cwd: webDir, env: process.env });
  await waitFor(`${WEB_ORIGIN}/login`, "web");

  writeFileSync(runtimeFile, JSON.stringify({ databaseUrl, mockUrl, apiOrigin: API_ORIGIN, webOrigin: WEB_ORIGIN, attachmentDir, ...CREDENTIALS }, null, 2));
  log(`ready: web ${WEB_ORIGIN}, api ${API_ORIGIN}, mock AI ${mockUrl}`);
}

main().catch(async (error) => {
  log(`startup failed: ${error?.message ?? error}`);
  await shutdown(1);
});
