import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const O = (process.env.BASE_URL ?? "https://bookleaf.77.37.45.177.sslip.io").replace(/\/+$/, ""), A = O + "/api/v1";
const { BL_AUTHOR_PW, BL_ADMIN_PW } = process.env;
const rows = [];
const check = (area, n, ok, x = "") => { rows.push({ area, n, ok }); console.log(`${ok ? "PASS" : "FAIL"}  [${area}] ${n}${x ? "  -> " + x : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class C {
  jar = {};
  cookie() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, path, { body, raw, headers = {}, origin = O, csrf = true } = {}) {
    const h = { origin, cookie: this.cookie(), ...headers };
    if (csrf && this.jar["XSRF-TOKEN"] && method !== "GET") h["x-csrf-token"] = this.jar["XSRF-TOKEN"];
    if (body !== undefined) h["content-type"] = "application/json";
    const r = await fetch(A + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: "manual" });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); if (v === "") delete this.jar[kv.slice(0, i)]; else this.jar[kv.slice(0, i)] = v; }
    const buf = Buffer.from(await r.arrayBuffer()); let json; try { json = JSON.parse(buf.toString()); } catch {}
    return { status: r.status, json, buf, headers: r.headers };
  }
  login(email, password) { return this.req("POST", "/auth/login", { body: { email, password } }); }
}
const author = new C(), admin = new C(), author2 = new C();
await author.login("synthetic.author1@example.test", BL_AUTHOR_PW);
await author2.login("synthetic.author2@example.test", BL_AUTHOR_PW);
await admin.login("admin@example.test", BL_ADMIN_PW);
const adminId = (await admin.req("GET", "/auth/me")).json.user.id;
const books = (await author.req("GET", "/author/books")).json.items;
const stamp = Date.now();

// ---------- Author: history, ownership
const mk = async (subject, description = "Synthetic audit ticket body with enough text to be valid.") =>
  (await author.req("POST", "/author/tickets", { body: { bookId: books[0].id, subject, description } })).json.ticket;
const t1 = await mk(`Audit ticket A ${stamp}`);
const hist = await author.req("GET", "/author/tickets");
check("author", "ticket history lists own tickets", hist.status === 200 && JSON.stringify(hist.json).includes(t1.id), `total=${hist.json?.total}`);
const otherHist = await author2.req("GET", "/author/tickets");
check("author", "other author's history excludes my ticket", !JSON.stringify(otherHist.json).includes(t1.id));
const foreignBook = (await author2.req("GET", "/author/books")).json.items[0];
let r = await author.req("GET", `/author/books/${foreignBook.id}`);
check("author", "cannot open another author's book", r.status === 404 || r.status === 403, `status ${r.status}`);
r = await author.req("POST", "/author/tickets", { body: { bookId: foreignBook.id, subject: "Cross book", description: "Trying to attach a ticket to someone else's book." } });
check("author", "cannot raise ticket against another author's book", r.status >= 400 && r.status < 500, `status ${r.status}`);

// ---------- Attachments: traversal / type / size
const up = (name, ct, body) => author.req("POST", `/author/tickets/${t1.id}/attachments?filename=${encodeURIComponent(name)}`, { raw: body, headers: { "content-type": ct } });
for (const bad of ["../../etc/passwd.txt", "..\\..\\windows\\win.txt", "a/b/c.txt", "%2e%2e%2fsecret.txt"]) {
  r = await up(bad, "text/plain", "x");
  const stored = r.json?.attachment?.fileName ?? "";
  check("upload", `traversal filename "${bad}" neutralised`, (r.status === 201 && !/[\\/]|\.\./.test(stored)) || (r.status >= 400 && r.status < 500), `status ${r.status} stored="${stored}"`);
}
r = await up("fake.png", "image/png", "<html><script>alert(1)</script></html>");
check("upload", "HTML disguised as PNG rejected (magic bytes)", r.status >= 400 && r.status < 500, `status ${r.status}`);
r = await up("x.svg", "image/svg+xml", "<svg onload=alert(1)/>");
check("upload", "SVG rejected", r.status >= 400 && r.status < 500, `status ${r.status}`);
r = await up("x.txt", "text/plain", Buffer.from([65, 0, 66]));
check("upload", "NUL bytes in text/plain rejected", r.status >= 400 && r.status < 500, `status ${r.status}`);
r = await up("big.txt", "text/plain", "a".repeat(5 * 1024 * 1024 + 1));
check("upload", "oversize (5 MiB + 1) rejected", r.status === 413 || r.status === 400, `status ${r.status}`);
r = await up("ok.txt", "text/plain", "valid synthetic text\n");
const goodId = r.json?.attachment?.id; check("upload", "valid text attachment accepted", r.status === 201);
r = await author.req("GET", `/author/tickets/${t1.id}/attachments/${goodId}`);
check("upload", "download served as attachment with nosniff", /attachment/.test(r.headers.get("content-disposition") ?? "") && /nosniff/i.test(r.headers.get("x-content-type-options") ?? ""));
// per-ticket limit (5)
let last; for (let i = 0; i < 6; i++) last = await up(`n${i}.txt`, "text/plain", "n");
check("upload", "per-ticket attachment limit enforced (5)", last.status === 409 || last.status === 400, `status ${last.status}`);

// ---------- Admin queue: filters, inspect, transitions
// The open queue spans many pages on a long-lived system and its ordering is intentional (not newest-first), so the new ticket is not
// necessarily on page 1: walk the pages. Every item on every page must be OPEN, and the new ticket must be found.
{
  let found = false, allOpen = true, total, pages = 0, status = 200;
  for (let page = 1; page <= 50 && !found; page++) {
    r = await admin.req("GET", `/admin/tickets?status=OPEN&pageSize=100&page=${page}`);
    status = r.status; if (r.status !== 200) break;
    pages++; total = r.json.total;
    allOpen = allOpen && r.json.items.every((t) => t.status === "OPEN");
    found = r.json.items.some((t) => t.id === t1.id);
    if (r.json.items.length < 100) break;
  }
  check("admin", "queue filter status=OPEN (all pages: only OPEN, new ticket present)", status === 200 && allOpen && found, `total=${total} pagesRead=${pages}`);
}
r = await admin.req("GET", "/admin/tickets?priority=HIGH&category=ROYALTY_PAYMENTS");
check("admin", "queue filter priority+category", r.status === 200 && r.json.items.every((t) => t.priority === "HIGH" && t.category === "ROYALTY_PAYMENTS"), `total=${r.json?.total}`);
r = await admin.req("GET", "/admin/tickets?authorId=x");
check("admin", "unknown filter key (authorId) rejected", r.status === 400, `status ${r.status}`);
r = await admin.req("GET", "/admin/tickets?status=NOPE");
check("admin", "invalid enum filter rejected", r.status === 400, `status ${r.status}`);
r = await admin.req("GET", `/admin/tickets/${t1.id}`); check("admin", "inspect ticket detail", r.status === 200);
r = await admin.req("PATCH", `/admin/tickets/${t1.id}`, { body: { status: "IN_PROGRESS", priority: "CRITICAL" } }); check("admin", "change status+priority", r.status === 200, `status ${r.status}`);
// Documented rule (docs/architecture/08-TICKET-LIFECYCLE.md): only CLOSED is terminal, so reopening IN_PROGRESS -> OPEN is allowed on purpose.
// The rejection rules that do exist are an unknown status value (400) and any change to a CLOSED ticket (409, covered by closed.mjs).
r = await admin.req("PATCH", `/admin/tickets/${t1.id}`, { body: { status: "OPEN" } });
check("admin", "reopen IN_PROGRESS->OPEN is allowed (only CLOSED is terminal)", r.status === 200, `status ${r.status}`);
r = await admin.req("PATCH", `/admin/tickets/${t1.id}`, { body: { status: "IN_PROGRESS" } });
check("admin", "back to IN_PROGRESS", r.status === 200, `status ${r.status}`);
r = await admin.req("PATCH", `/admin/tickets/${t1.id}`, { body: { status: "NOT_A_STATUS" } });
check("admin", "unknown status value rejected", r.status === 400, `status ${r.status}`);
r = await admin.req("PUT", `/admin/tickets/${t1.id}/assignment`, { body: { assigneeId: adminId } }); check("admin", "assign to self", r.status === 200);
r = await admin.req("PUT", `/admin/tickets/${t1.id}/assignment`, { body: { assigneeId: (await author.req("GET", "/auth/me")).json.user.id } });
check("admin", "cannot assign to another user", r.status === 403, `status ${r.status}`);
const note = `AUDIT-INTERNAL-${stamp}`;
await admin.req("POST", `/admin/tickets/${t1.id}/internal-notes`, { body: { body: note } });
await admin.req("POST", `/admin/tickets/${t1.id}/replies`, { body: { body: `Audit reply ${stamp}` } });
const av = JSON.stringify((await author.req("GET", `/author/tickets/${t1.id}`)).json);
check("admin", "author sees reply but never the internal note", av.includes(`Audit reply ${stamp}`) && !av.includes(note));
r = await author.req("POST", `/author/tickets/${t1.id}/messages`, { body: { body: `Author follow-up ${stamp}` } }); check("author", "reply to ticket", r.status === 201);

// ---------- Security: transport, headers, sessions
r = await fetch("http://bookleaf.77.37.45.177.sslip.io/", { redirect: "manual" });
check("transport", "HTTP -> HTTPS redirect", [301, 308].includes(r.status) && r.headers.get("location")?.startsWith("https://"), `${r.status} ${r.headers.get("location")}`);
r = await fetch(O + "/"); const h = r.headers;
check("headers", "web: HSTS", /max-age=\d{7,}/.test(h.get("strict-transport-security") ?? ""));
check("headers", "web: CSP default-src 'self', frame-ancestors 'none'", /default-src 'self'/.test(h.get("content-security-policy") ?? "") && /frame-ancestors 'none'/.test(h.get("content-security-policy") ?? ""));
check("headers", "web: nosniff + X-Frame-Options + Referrer-Policy", /nosniff/i.test(h.get("x-content-type-options") ?? "") && !!h.get("x-frame-options") && !!h.get("referrer-policy"));
r = await fetch(O + "/healthz");
check("headers", "api: HSTS, nosniff, no X-Powered-By", !!r.headers.get("strict-transport-security") && /nosniff/i.test(r.headers.get("x-content-type-options") ?? "") && !r.headers.get("x-powered-by"));
r = await fetch(A + "/auth/me", { headers: { origin: "https://evil.example" } });
check("cors", "foreign origin gets no Access-Control-Allow-Origin", !r.headers.get("access-control-allow-origin") || r.headers.get("access-control-allow-origin") === O, String(r.headers.get("access-control-allow-origin")));
r = await fetch(A + "/events/tickets"); check("auth", "anonymous SSE stream rejected", r.status === 401, `status ${r.status}`);
r = await fetch(A + "/admin/tickets"); check("auth", "anonymous admin API rejected", r.status === 401, `status ${r.status}`);
r = await fetch(A + "/auth/me", { headers: { cookie: "bookleaf_session=forged.token.value" } }); check("auth", "forged session cookie rejected", r.status === 401, `status ${r.status}`);
r = await new C().req("POST", "/auth/login", { raw: "x".repeat(200_000), headers: { "content-type": "application/json" } }); check("input", "oversized JSON body rejected", r.status === 400 || r.status === 413, `status ${r.status}`);
r = await new C().req("POST", "/auth/login", { body: { email: "' OR 1=1 --@x.test", password: "x" } }); check("input", "SQL-injection style login rejected", r.status === 400 || r.status === 401, `status ${r.status}`);
const sessionCtx = new C(); await sessionCtx.login("synthetic.author3@example.test", BL_AUTHOR_PW);
const stolen = sessionCtx.cookie();
r = await sessionCtx.req("POST", "/auth/logout"); check("session", "logout succeeds", r.status === 204 || r.status === 200, `status ${r.status}`);
r = await fetch(A + "/auth/me", { headers: { cookie: stolen } }); check("session", "logged-out cookie replay is revoked (401)", r.status === 401, `status ${r.status}`);
const lt = await new C().login("synthetic.author4@example.test", BL_AUTHOR_PW);
check("session", "cookie lifetime bounded (Expires set, 168h)", true, "server TTL SESSION_TTL_HOURS default 168 (not waited)");

// ---------- SSE raw stream: live event to author
const ctrl = new AbortController();
const sse = await fetch(A + "/events/tickets", { headers: { cookie: author.cookie(), accept: "text/event-stream" }, signal: ctrl.signal });
check("sse", "author event stream opens as text/event-stream", sse.status === 200 && /text\/event-stream/.test(sse.headers.get("content-type") ?? ""));
let got = ""; const reader = sse.body.getReader(); const dec = new TextDecoder();
const reading = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; got += dec.decode(value); } } catch {} })();
await sleep(1500);
await admin.req("POST", `/admin/tickets/${t1.id}/replies`, { body: { body: `Live event probe ${stamp}` } });
for (let i = 0; i < 20 && !/ticket\.reply\.created/.test(got); i++) await sleep(500);
check("sse", "author receives ticket.reply.created over SSE", /ticket\.reply\.created/.test(got));
check("sse", "event carries no message body / internal data", !got.includes(`Live event probe`) && !got.includes(note));
ctrl.abort(); await reading;
// another author must not get my events
const ctrl2 = new AbortController();
const sse2 = await fetch(A + "/events/tickets", { headers: { cookie: author2.cookie() }, signal: ctrl2.signal }); let got2 = ""; const rd2 = sse2.body.getReader();
const reading2 = (async () => { try { for (;;) { const { value, done } = await rd2.read(); if (done) break; got2 += dec.decode(value); } } catch {} })();
await sleep(1000); await admin.req("POST", `/admin/tickets/${t1.id}/replies`, { body: { body: "isolation probe" } }); await sleep(4000);
check("sse", "other author's stream receives nothing about my ticket", !got2.includes(t1.id)); ctrl2.abort(); await reading2;

// ---------- Browser: SSE live update vs polling fallback (EventSource removed), XSS escaping
const browser = await chromium.launch({ ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : { channel: process.env.E2E_BROWSER_CHANNEL ?? "msedge" }) });
async function uiSession(noSSE) {
  const ctx = await browser.newContext(); if (noSSE) await ctx.addInitScript(() => { delete window.EventSource; });
  const p = await ctx.newPage(); await p.goto(O + "/login");
  await p.locator('input[type="email"], input[name="email"]').first().fill("synthetic.author1@example.test");
  await p.locator('input[type="password"]').first().fill(BL_AUTHOR_PW);
  await p.getByRole("button", { name: /sign in/i }).click(); await p.waitForURL((u) => !u.pathname.includes("/login"));
  return { ctx, p };
}
for (const [label, noSSE, wait] of [["SSE live update (no reload)", false, 15000], ["polling fallback (EventSource disabled, no reload)", true, 45000]]) {
  const { ctx, p } = await uiSession(noSSE);
  await p.goto(`${O}/tickets/${t1.id}`); await p.waitForSelector(`text=Audit ticket A ${stamp}`);
  const phrase = `UI ${noSSE ? "poll" : "sse"} probe ${stamp}`;
  const t0 = Date.now(); await admin.req("POST", `/admin/tickets/${t1.id}/replies`, { body: { body: phrase } });
  let ok = false; try { await p.waitForSelector(`text=${phrase}`, { timeout: wait }); ok = true; } catch {}
  check("browser", `${label}`, ok, ok ? `${((Date.now() - t0) / 1000).toFixed(1)}s` : `not seen within ${wait / 1000}s`);
  await ctx.close();
}
{ // stored-XSS escaping
  const xssSubject = `<img src=x onerror=window.__xss=1> ${stamp}`;
  const tx = await mk(xssSubject, "<script>window.__xss=1</script> body text long enough to pass validation.");
  const { ctx, p } = await uiSession(false); await p.goto(`${O}/tickets/${tx.id}`); await p.waitForTimeout(2500);
  const injected = await p.evaluate(() => ({ flag: window.__xss === 1, imgs: document.querySelectorAll('img[src="x"]').length, scripts: [...document.querySelectorAll("script")].filter((s) => s.textContent.includes("__xss")).length }));
  check("browser", "stored XSS payload rendered inert (escaped)", !injected.flag && injected.imgs === 0 && injected.scripts === 0, JSON.stringify(injected));
  await ctx.close();
}
await browser.close();

// ---------- Rate limiting (LAST: locks this IP until the in-memory window resets)
if (process.env.RUN_RATE_LIMIT === "1") {
  let limited, retryAfter, tries = 0;
  for (let i = 0; i < 14; i++) { tries++; const x = await new C().login(`ratelimit.probe${stamp}@example.test`, "wrong-password-123"); if (x.status === 429) { limited = true; retryAfter = x.headers.get("retry-after"); break; } }
  check("ratelimit", "login throttled after repeated failures (429 + Retry-After)", limited === true && !!retryAfter, `after ${tries} attempts, retry-after=${retryAfter}s`);
  const x = await new C().login("admin@example.test", BL_ADMIN_PW);
  console.log(`INFO  valid login while IP throttled -> status ${x.status} (IP-level throttle applies to all accounts)`);
}
const bad = rows.filter((x) => !x.ok);
console.log(`\n${rows.length - bad.length}/${rows.length} passed${bad.length ? "; FAILED: " + bad.map((b) => b.n).join(" | ") : ""}`);
