import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const O = (process.env.BASE_URL ?? "https://bookleaf.77.37.45.177.sslip.io").replace(/\/+$/, ""), A = O + "/api/v1";
const { BL_AUTHOR_PW, BL_ADMIN_PW } = process.env;
const shots = (await import("node:os")).tmpdir() + "/bookleaf-ux-shots";
fs.mkdirSync(shots, { recursive: true });

// ids via API
const lg = async (e, p) => { const r = await fetch(A + "/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: O }, body: JSON.stringify({ email: e, password: p }) }); return r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; "); };
const ac = await lg("synthetic.author1@example.test", BL_AUTHOR_PW), dc = await lg("admin@example.test", BL_ADMIN_PW);
const get = async (c, p) => (await fetch(A + p, { headers: { cookie: c } })).json();
const bookId = (await get(ac, "/author/books")).items[0].id, ticketId = (await get(ac, "/author/tickets")).items[0].id;

const viewports = [[1920, 1080], [1366, 768], [768, 1024], [390, 844], [360, 740]];
const pages = {
  public: [["/login", "login"], ["/no-such-page", "404"]],
  author: [["/dashboard", "dashboard"], ["/books", "books"], [`/books/${bookId}`, "book-detail"], ["/tickets", "tickets"], ["/tickets/new", "new-ticket"], [`/tickets/${ticketId}`, "ticket-detail"]],
  admin: [["/admin/dashboard", "admin-dashboard"], ["/admin/queue", "admin-queue"], [`/admin/tickets/${ticketId}`, "admin-ticket"]]
};
const browser = await chromium.launch({ ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : { channel: process.env.E2E_BROWSER_CHANNEL ?? "msedge" }) });
const issues = []; let checks = 0;
async function loginUi(p, email, pw) { await p.goto(O + "/login"); await p.locator('input[type="email"], input[name="email"]').first().fill(email); await p.locator('input[type="password"]').first().fill(pw); await p.getByRole("button", { name: /sign in/i }).click(); await p.waitForURL((u) => !u.pathname.includes("/login")); }
for (const [w, h] of viewports) {
  for (const role of ["public", "author", "admin"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage(); const con = [], bad = [];
    p.on("console", (m) => { if (m.type() === "error") con.push(m.text().slice(0, 140)); });
    p.on("pageerror", (e) => con.push("pageerror: " + String(e.message).slice(0, 140)));
    p.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    if (role === "author") await loginUi(p, "synthetic.author1@example.test", BL_AUTHOR_PW);
    if (role === "admin") await loginUi(p, "admin@example.test", BL_ADMIN_PW);
    for (const [path, name] of pages[role]) {
      con.length = 0; bad.length = 0; checks++;
      await p.goto(O + path, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(1800);
      const m = await p.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, text: document.body.innerText, h1: document.querySelectorAll("h1,h2").length }));
      const problems = [];
      if (m.over > 1) problems.push(`horizontal overflow ${m.over}px`);
      if (/\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/.test(m.text)) problems.push("broken text (undefined/NaN/null/[object Object])");
      const expected404 = name === "404";
      const realBad = bad.filter((b) => !(expected404 && /^404 \//.test(b)) && !/^401 \/api\/v1\/(auth\/me|events)/.test(b));
      if (realBad.length) problems.push("failed requests: " + [...new Set(realBad)].join(", "));
      const realCon = con.filter((c) => !/Failed to load resource.*(401|404)/.test(c));
      if (realCon.length) problems.push("console errors: " + realCon.slice(0, 2).join(" | "));
      if (problems.length) { issues.push({ viewport: `${w}x${h}`, role, page: name, problems }); await p.screenshot({ path: `${shots}/${w}-${role}-${name}.png`, fullPage: false }); }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`${checks} page/viewport checks (${viewports.length} viewports x ${Object.values(pages).flat().length} pages incl. roles)`);
if (!issues.length) console.log("no overflow, console errors, failed requests or broken text found");
for (const i of issues) console.log(`ISSUE  ${i.viewport}  ${i.role}/${i.page}: ${i.problems.join("; ")}`);
