// Live check of the admin AI failure notice (release with AiFailureNotice). Uses EXISTING analysis attempts only: it makes no model request and
// creates no ticket. Browser: Chrome/Edge through Playwright (set E2E_CHROMIUM_PATH). Passwords are never printed.
//   BL_ADMIN_PW=... [BASE_URL=https://...] node tests/live/failure-notice-verify.mjs
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const O = (process.env.BASE_URL ?? "https://bookleaf.77.37.45.177.sslip.io").replace(/\/+$/, ""), API = O + "/api/v1";
const { BL_ADMIN_PW } = process.env;
if (!BL_ADMIN_PW) { console.log("BLOCKED: set BL_ADMIN_PW"); process.exit(2); }
const rows = [];
const check = async (name, fn) => { try { const extra = await fn(); rows.push(true); console.log("PASS  " + name + (extra ? "  -> " + extra : "")); } catch (e) { rows.push(false); console.log("FAIL  " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 200)); } };

// 1. Find existing tickets by API (read-only): one whose latest AI attempt FAILED, one whose attempt COMPLETED.
const jar = {};
const keep = (r) => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); } };
const ck = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
let r = await fetch(API + "/auth/login", { method: "POST", headers: { origin: O, "content-type": "application/json" }, body: JSON.stringify({ email: "admin@example.test", password: BL_ADMIN_PW }) });
keep(r);
const get = async (p) => (await fetch(API + p, { headers: { cookie: ck() } })).json();
const list = await get("/admin/tickets?pageSize=100&page=1");
let failedId, completedId, failedCode, completedDemo = false, apiLeak = false;
for (const t of list.items) {
  const a = (await get(`/admin/tickets/${t.id}/ai-analysis`)).analysis;
  if (JSON.stringify(a ?? {}).match(/sk-or-|Bearer |api[_-]?key/i)) apiLeak = true;
  if (a?.status === "FAILED" && !failedId) { failedId = t.id; failedCode = a.errorCode; }
  if (a?.status === "COMPLETED" && !completedId) { completedId = t.id; completedDemo = /\[DEMO (MOCK|DRAFT)/.test(JSON.stringify(a)); }
  if (failedId && completedId) break;
}
console.log(`INFO  found failed attempt on ${failedId ? "a ticket (" + failedCode + ")" : "no ticket"}; completed attempt on ${completedId ? "a ticket" + (completedDemo ? " (historical demo-labelled analysis from the mock era)" : "") : "no ticket"}`);

const browser = await chromium.launch({ ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : { channel: process.env.E2E_BROWSER_CHANNEL ?? "msedge" }) });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const consoleErrors = [], failedReqs = [];
// The anonymous login page always probes the session (GET /auth/me) and the event stream (GET /events/tickets) and gets 401: expected, and
// the browser logs it as a "Failed to load resource" console error. Everything else (other 4xx, any 5xx, script errors) is a real problem.
const EXPECTED_ANON_401 = /^401 GET \/api\/v1\/(auth\/me|events\/tickets)$/;
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) consoleErrors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e.message).slice(0, 160)));
page.on("response", (res) => { const line = `${res.status()} ${res.request().method()} ${res.url().replace(O, "")}`; if (res.status() >= 400 && !EXPECTED_ANON_401.test(line)) failedReqs.push(line); });

await check("admin signs in (UI) and the dashboard loads", async () => {
  await page.goto(O + "/login");
  await page.locator('input[type="email"], input[name="email"]').first().fill("admin@example.test");
  await page.locator('input[type="password"]').first().fill(BL_ADMIN_PW);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/admin\/dashboard/, { timeout: 15000 });
  await expect(page.locator("body")).not.toContainText(/something went wrong|failed to load/i);
});

if (failedId) {
  await check("FAILED attempt shows the failure notice with its error code", async () => {
    await page.goto(`${O}/admin/tickets/${failedId}`);
    await expect(page.getByTestId("ai-failed")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("ai-failed")).toContainText(`AI analysis failed (${failedCode})`);
    return failedCode;
  });
  await check("quota exhaustion is described accurately and no draft/insert button is offered", async () => {
    const box = page.getByTestId("ai-failed");
    if (failedCode === "AI_RATE_LIMITED") await expect(box).toContainText(/usage limit was reached/i);
    await expect(box).toContainText(/No draft was generated and nothing was sent to the author/);
    await expect(page.getByRole("button", { name: "Insert Draft into Reply Box" })).toHaveCount(0);
  });
  await check("no longer shows the misleading 'No AI analysis record generated yet'", async () => { await expect(page.getByText(/No AI analysis record generated yet/)).toHaveCount(0); });
  await check("Re-run AI stays available; opening the page sends nothing (message count unchanged)", async () => {
    const before = (await get(`/admin/tickets/${failedId}`)).messages.length;
    await page.goto(`${O}/admin/tickets/${failedId}`);
    await expect(page.getByRole("button", { name: /Re-run AI/ })).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const after = (await get(`/admin/tickets/${failedId}`)).messages.length;
    if (after !== before) throw new Error(`messages ${before} -> ${after}`);
    return `messages stayed at ${after}`;
  });
  await check("no key, bearer token or provider response text in the page", async () => {
    const text = await page.locator("body").innerText(); const html = await page.content();
    if (/sk-or-|Bearer |openrouter\.ai\/api/i.test(text + html)) throw new Error("provider/secret string present in page");
    if (apiLeak) throw new Error("secret-like string present in an ai-analysis API response");
  });
  await check("no demo-only labels on this failed-attempt page", async () => { await expect(page.getByText(/\[DEMO (MOCK|DRAFT)/)).toHaveCount(0); });
  await check("mobile layout (375x812): notice visible, no horizontal overflow", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${O}/admin/tickets/${failedId}`);
    await expect(page.getByTestId("ai-failed")).toBeVisible({ timeout: 15000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error("horizontal overflow of " + overflow + "px");
    await page.setViewportSize({ width: 1280, height: 800 });
  });
} else console.log("INFO  no FAILED attempt exists to verify the notice against");

if (completedId) {
  await check("a COMPLETED analysis still displays normally (confidence, human review, draft, insert button)", async () => {
    await page.goto(`${O}/admin/tickets/${completedId}`);
    await expect(page.getByRole("button", { name: "Insert Draft into Reply Box" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Human Review Required")).toBeVisible();
    await expect(page.getByTestId("ai-failed")).toHaveCount(0);
    return completedDemo ? "page is a historical mock-era ticket; its demo labels are stored data" : "";
  });
}
await check("no browser script errors and no unexpected 4xx/5xx responses", async () => {
  if (consoleErrors.length || failedReqs.length) throw new Error(`console=${JSON.stringify(consoleErrors.slice(0, 3))} 5xx=${JSON.stringify(failedReqs.slice(0, 3))}`);
});
await browser.close();
console.log(`\n${rows.filter(Boolean).length}/${rows.length} checks passed`);
process.exit(rows.every(Boolean) ? 0 : 1);
