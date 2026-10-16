import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const O = (process.env.BASE_URL ?? "https://bookleaf.77.37.45.177.sslip.io").replace(/\/+$/, ""), A = O + "/api/v1";
const { BL_AUTHOR_PW, BL_ADMIN_PW } = process.env;
const rows = []; const rec = (n, ok, x = "") => { rows.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };
const lg = async (e, p) => { const r = await fetch(A + "/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: O }, body: JSON.stringify({ email: e, password: p }) }); const ck = r.headers.getSetCookie().map((x) => x.split(";")[0]); return { c: ck.join("; "), x: ck.find((v) => v.startsWith("XSRF")).split("=")[1] }; };
const au = await lg("synthetic.author1@example.test", BL_AUTHOR_PW), ad = await lg("admin@example.test", BL_ADMIN_PW);
const J = (s) => ({ cookie: s.c, origin: O, "x-csrf-token": s.x, "content-type": "application/json" });
const book = (await (await fetch(A + "/author/books", { headers: { cookie: au.c } })).json()).items[0];
const stamp = Date.now();
const t = (await (await fetch(A + "/author/tickets", { method: "POST", headers: J(au), body: JSON.stringify({ bookId: book.id, subject: `Realtime probe ${stamp}`, description: "Ticket used to measure live update behaviour in the browser." }) })).json()).ticket;
const adminSay = (text) => fetch(A + `/admin/tickets/${t.id}/replies`, { method: "POST", headers: J(ad), body: JSON.stringify({ body: text }) });
const browser = await chromium.launch({ ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : { channel: process.env.E2E_BROWSER_CHANNEL ?? "msedge" }) });
async function open(noSSE = false) { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(O + "/login"); await p.locator('input[type="email"]').first().fill("synthetic.author1@example.test"); await p.locator('input[type="password"]').first().fill(BL_AUTHOR_PW); await p.getByRole("button", { name: /sign in/i }).click(); await p.waitForURL((u) => !u.pathname.includes("/login")); await p.goto(`${O}/tickets/${t.id}`); await p.waitForSelector(`text=Realtime probe ${stamp}`); return { ctx, p }; }
const waitFor = async (p, text, ms) => { const t0 = Date.now(); try { await p.waitForSelector(`text=${text}`, { timeout: ms }); return Date.now() - t0; } catch { return -1; } };

// 1) latency samples (SSE)
{ const { ctx, p } = await open(); const lat = [];
  for (let i = 1; i <= 5; i++) { const phrase = `latency sample ${i} ${stamp}`; await adminSay(phrase); lat.push(await waitFor(p, phrase, 15000)); await p.waitForTimeout(400); }
  rec("SSE delivery: 5 replies reach an open ticket page without reload", lat.every((x) => x >= 0), `observed ms: ${lat.join(", ")} (min ${Math.min(...lat)}, max ${Math.max(...lat)})`); await ctx.close(); }

// 2) two simultaneous sessions of the same author both update
{ const a = await open(), b = await open(); const phrase = `two sessions ${stamp}`; await adminSay(phrase);
  const [x, y] = await Promise.all([waitFor(a.p, phrase, 15000), waitFor(b.p, phrase, 15000)]);
  rec("two browser sessions of the same author both receive the update", x >= 0 && y >= 0, `ms: ${x}, ${y}`); await a.ctx.close(); await b.ctx.close(); }

// 3) duplicate handling: each message appears exactly once after several events + a manual refresh
{ const { ctx, p } = await open(); const phrase = `dedupe check ${stamp}`; await adminSay(phrase); await waitFor(p, phrase, 15000);
  await adminSay(`filler 1 ${stamp}`); await adminSay(`filler 2 ${stamp}`); await p.waitForTimeout(2500);
  const n1 = await p.getByText(phrase).count(); await p.reload(); await p.waitForSelector(`text=${phrase}`); const n2 = await p.getByText(phrase).count();
  rec("each message shown exactly once (live, and after refresh)", n1 === 1 && n2 === 1, `live=${n1} after-refresh=${n2}`); await ctx.close(); }

// 4) network interruption: go offline, admin replies, come back online
{ const { ctx, p } = await open(); await p.waitForTimeout(1500); const phrase = `while offline ${stamp}`;
  await ctx.setOffline(true); await p.waitForTimeout(1500); await adminSay(phrase); await p.waitForTimeout(5000);
  const during = await p.getByText(phrase).count(); await ctx.setOffline(false);
  const back = await waitFor(p, phrase, 45000);
  rec("after a network drop the page catches up with the missed reply", during === 0 && back >= 0, `not shown while offline=${during === 0}; appeared ${back} ms after reconnect`); await ctx.close(); }

// 5) cross-author: another author's open pages never show this ticket's replies
{ const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(O + "/login"); await p.locator('input[type="email"]').first().fill("synthetic.author2@example.test"); await p.locator('input[type="password"]').first().fill(BL_AUTHOR_PW); await p.getByRole("button", { name: /sign in/i }).click(); await p.waitForURL((u) => !u.pathname.includes("/login")); await p.goto(O + "/tickets"); await p.waitForTimeout(1500);
  const phrase = `cross author ${stamp}`; await adminSay(phrase); await p.waitForTimeout(6000); await p.goto(`${O}/tickets/${t.id}`); await p.waitForTimeout(2000);
  const body = await p.locator("body").innerText();
  rec("another author's session never shows this ticket's content (live or by direct URL)", !body.includes(phrase) && !body.includes(`Realtime probe ${stamp}`), "direct URL shows: " + body.replace(/\s+/g, " ").slice(0, 60)); await ctx.close(); }
await browser.close(); console.log(`\n${rows.filter(Boolean).length}/${rows.length} realtime checks passed`);
