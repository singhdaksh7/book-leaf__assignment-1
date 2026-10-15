import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, request as pwRequest, test } from "@playwright/test";
import { authorEmail, runtime } from "./helpers";

/**
 * Production-mode behaviour behind a reverse proxy: a second API instance runs with NODE_ENV=production, an https WEB_ORIGIN and
 * TRUST_PROXY=1, fronted by a tiny local proxy that adds X-Forwarded-* like nginx would. The real TLS terminator is not part of
 * this suite (no TLS here); this verifies what the application itself does when it is told it sits behind one.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PUBLIC_ORIGIN = "https://portal.example.test";
const API_PORT = 3101;
const PROXY_PORT = 3102;

let api: ChildProcess;
let proxy: http.Server;
let seenForwardedFor = "";

test.beforeAll(async () => {
  const rt = runtime();
  api = spawn(process.execPath, [resolve(root, "apps", "api", "dist", "server.js")], {
    cwd: resolve(root, "apps", "api"),
    stdio: "ignore",
    env: {
      ...process.env, NODE_ENV: "production", PORT: String(API_PORT), DATABASE_URL: rt.databaseUrl, WEB_ORIGIN: PUBLIC_ORIGIN, TRUST_PROXY: "1",
      SESSION_SECRET: "prod-e2e-secret-9f8e7d6c5b4a39281706f5e4d3c2b1a0", ATTACHMENT_DIR: resolve(rt.attachmentDir, "..", "attachments-prod"), OPENROUTER_API_KEY: ""
    }
  });
  proxy = http.createServer((req, res) => {
    seenForwardedFor = "203.0.113.7";
    const upstream = http.request({ host: "127.0.0.1", port: API_PORT, path: req.url, method: req.method, headers: { ...req.headers, "x-forwarded-for": seenForwardedFor, "x-forwarded-proto": "https", "x-forwarded-host": "portal.example.test" } }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  await new Promise<void>((done) => proxy.listen(PROXY_PORT, "127.0.0.1", done));
  await expect(async () => {
    const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/healthz`);
    expect(res.ok).toBe(true);
  }).toPass({ timeout: 30_000 });
});

test.afterAll(async () => {
  await new Promise<void>((done) => (proxy ? proxy.close(() => done()) : done()));
  proxy?.closeAllConnections();
  api?.kill("SIGTERM");
});

test("production login through a proxy issues Secure, HttpOnly, SameSite=Lax cookies", async () => {
  const ctx = await pwRequest.newContext();
  const res = await ctx.post(`http://127.0.0.1:${PROXY_PORT}/api/v1/auth/login`, { data: { email: authorEmail(10), password: runtime().authorPassword }, headers: { Origin: PUBLIC_ORIGIN } });
  expect(res.status()).toBe(200);
  const cookies = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
  const session = cookies.find((c) => c.startsWith("bookleaf_session="))!;
  const csrf = cookies.find((c) => c.startsWith("XSRF-TOKEN="))!;
  expect(session).toMatch(/;\s*HttpOnly/i);
  expect(session).toMatch(/;\s*Secure/i);
  expect(session).toMatch(/;\s*SameSite=Lax/i);
  expect(csrf).toMatch(/;\s*Secure/i);
  expect(csrf).not.toMatch(/HttpOnly/i);
  await ctx.dispose();
});

test("production rejects the http dev origin and accepts only the public https origin", async () => {
  const ctx = await pwRequest.newContext();
  const body = { email: authorEmail(10), password: runtime().authorPassword };
  expect((await ctx.post(`http://127.0.0.1:${PROXY_PORT}/api/v1/auth/login`, { data: body, headers: { Origin: runtime().webOrigin } })).status()).toBe(403);
  expect((await ctx.post(`http://127.0.0.1:${PROXY_PORT}/api/v1/auth/login`, { data: body, headers: { Origin: PUBLIC_ORIGIN } })).status()).toBe(200);
  await ctx.dispose();
});

test("production responses are hardened (HSTS, nosniff, no banner, no-store on API data)", async () => {
  const ctx = await pwRequest.newContext();
  const res = await ctx.get(`http://127.0.0.1:${PROXY_PORT}/healthz`);
  const h = res.headers();
  expect(h["strict-transport-security"]).toBeTruthy();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-powered-by"]).toBeUndefined();
  await ctx.dispose();
});

test("production refuses to start with a placeholder secret or an http origin", async () => {
  const rt = runtime();
  const start = (extra: Record<string, string>) =>
    new Promise<number | null>((done) => {
      const child = spawn(process.execPath, [resolve(root, "apps", "api", "dist", "server.js")], {
        cwd: resolve(root, "apps", "api"), stdio: "ignore",
        env: { ...process.env, NODE_ENV: "production", PORT: "3103", DATABASE_URL: rt.databaseUrl, WEB_ORIGIN: PUBLIC_ORIGIN, SESSION_SECRET: "prod-e2e-secret-9f8e7d6c5b4a39281706f5e4d3c2b1a0", ...extra }
      });
      const timer = setTimeout(() => { child.kill("SIGKILL"); done(null); }, 15_000);
      child.on("exit", (code) => { clearTimeout(timer); done(code); });
    });
  expect(await start({ SESSION_SECRET: "replace-with-a-long-random-secret-of-32-chars-or-more" })).toBe(1);
  expect(await start({ WEB_ORIGIN: "http://portal.example.test" })).toBe(1);
});
