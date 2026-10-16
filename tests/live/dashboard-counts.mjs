// Compares what the dashboards SHOW with what the API says (the authoritative source), in a real browser.
// Regression check for BUG-004: KPIs were derived from one page of results (50 admin / 25 author tickets).
//
//   BL_AUTHOR_PW=... BL_ADMIN_PW=... node tests/live/dashboard-counts.mjs
//   ENSURE_UNRESOLVED_OVER=100 ...     first creates synthetic tickets (authors 5-9) until more than N unresolved tickets exist,
//                                      so the check runs with more tickets than one API page (max page size is 100)
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const O = (process.env.BASE_URL ?? "https://bookleaf.77.37.45.177.sslip.io").replace(/\/+$/, ""), A = O + "/api/v1";
const { BL_AUTHOR_PW, BL_ADMIN_PW } = process.env;
const AUTHOR = process.env.AUTHOR_EMAIL ?? "synthetic.author1@example.test", ADMIN = process.env.ADMIN_EMAIL ?? "admin@example.test";
const rows = []; const check = (n, ok, x = "") => { rows.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };

const login = async (email, pw) => { const r = await fetch(A + "/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: O }, body: JSON.stringify({ email, password: pw }) }); if (r.status !== 200) throw new Error("login failed " + email); const ck = r.headers.getSetCookie().map((x) => x.split(";")[0]); return { c: ck.join("; "), x: ck.find((v) => v.startsWith("XSRF"))?.split("=")[1] }; };
const get = async (s, p) => (await fetch(A + p, { headers: { cookie: s.c } })).json();
const adminAll = async (s) => { const all = []; for (let p = 1; ; p++) { const r = await get(s, `/admin/tickets?pageSize=100&page=${p}`); all.push(...r.items); if (all.length >= r.total) return all; } };
const isUnresolved = (t) => t.status === "OPEN" || t.status === "IN_PROGRESS";

const admin = await login(ADMIN, BL_ADMIN_PW), author = await login(AUTHOR, BL_AUTHOR_PW);
const me = (await get(admin, "/auth/me")).user.id;

const over = Number(process.env.ENSURE_UNRESOLVED_OVER ?? 0);
if (over > 0) {
  let made = 0, unresolved = (await adminAll(admin)).filter(isUnresolved).length;
  for (const n of [5, 6, 7, 8, 9]) {
    if (unresolved > over) break;
    const s = await login(`synthetic.author${n}@example.test`, BL_AUTHOR_PW);
    const book = (await get(s, "/author/books")).items[0];
    for (let i = 0; i < 25 && unresolved <= over; i++) {
      const r = await fetch(A + "/author/tickets", { method: "POST", headers: { cookie: s.c, origin: O, "x-csrf-token": s.x, "content-type": "application/json" }, body: JSON.stringify({ bookId: book.id, subject: `Dashboard volume ticket ${Date.now()}-${i}`, description: "Synthetic ticket created to exceed one API page for the dashboard count check." }) });
      if (r.status === 201) { made++; unresolved++; } else break;
    }
  }
  console.log(`INFO  created ${made} synthetic tickets; unresolved now ${unresolved}`);
}

const all = await adminAll(admin), unres = all.filter(isUnresolved);
const truth = { unresolved: unres.length, urgent: unres.filter((t) => t.priority === "CRITICAL" || t.priority === "HIGH").length, unassigned: unres.filter((t) => !t.assigneeId).length, mine: unres.filter((t) => t.assigneeId === me).length };
const mine = await get(author, "/author/tickets?pageSize=100");
const authorTruth = (await get(author, "/author/tickets?status=OPEN&pageSize=1")).total + (await get(author, "/author/tickets?status=IN_PROGRESS&pageSize=1")).total;
console.log(`TRUTH admin: total=${all.length} unresolved=${truth.unresolved} urgent=${truth.urgent} unassigned=${truth.unassigned} mine=${truth.mine}; ${truth.unresolved > 100 ? "MORE than one API page (100)" : "within one API page"}`);
console.log(`TRUTH author: total=${mine.total} active=${authorTruth}; ${authorTruth > 25 ? "MORE than the 25 most recent" : "within 25"}`);

const browser = await chromium.launch(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : { channel: process.env.E2E_BROWSER_CHANNEL ?? "msedge" });
async function open(email, pw, path) { const p = await (await browser.newContext()).newPage(); await p.goto(O + "/login"); await p.locator('input[type="email"]').first().fill(email); await p.locator('input[type="password"]').first().fill(pw); await p.getByRole("button", { name: /sign in/i }).click(); await p.waitForURL((u) => !u.pathname.includes("/login")); await p.goto(O + path); await p.waitForTimeout(3000); return p; }
const card = (p, title) => p.evaluate((t) => { const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent.trim().toLowerCase() === t.toLowerCase()); const c = el?.closest('[class*="border-l"]'); const m = c?.innerText.replace(/\s+/g, " ").match(/(\d[\d,]*)\+?/); return m ? Number(m[1].replace(/,/g, "")) : null; }, title);

const ap = await open(ADMIN, BL_ADMIN_PW, "/admin/dashboard");
for (const [title, want] of [["Unresolved Tickets", truth.unresolved], ["Urgent & Critical", truth.urgent], ["Awaiting Assignment", truth.unassigned], ["Assigned to Me", truth.mine]]) { const got = await card(ap, title); check(`admin dashboard "${title}" equals the API`, got === want, `shown ${got}, API ${want}`); }
const header = await ap.getByText(/Open Ticket Queue \(/).first().innerText().catch(() => ""); check("admin 'Open Ticket Queue (n)' equals the API", header.includes(`(${truth.unresolved})`), header.replace(/\s+/g, " "));
const up = await open(AUTHOR, BL_AUTHOR_PW, "/dashboard");
const sub = await up.getByText(/\d+ active support inquir/i).first().innerText().catch(() => ""); const shown = Number((sub.match(/(\d+)/) ?? [])[1] ?? NaN);
check("author dashboard active-ticket count equals the API", shown === authorTruth, `shown ${shown}, API ${authorTruth}`);
const viewAll = await up.getByText(/View All \(\d+\)/).first().innerText().catch(() => ""); check("author 'View All (n)' equals the API total", viewAll.includes(`(${mine.total})`), viewAll.replace(/\s+/g, " "));
await browser.close();
console.log(`\n${rows.filter(Boolean).length}/${rows.length} dashboard checks passed`); process.exitCode = rows.every(Boolean) ? 0 : 1;
