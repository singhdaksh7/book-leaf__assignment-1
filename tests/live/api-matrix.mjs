import { pathToFileURL } from "node:url";
const C = await import(new URL("../../packages/contracts/dist/index.js", import.meta.url).href);
const O = (process.env.BASE_URL ?? "https://bookleaf.77.37.45.177.sslip.io").replace(/\/+$/, ""), A = O + "/api/v1";
const { BL_AUTHOR_PW, BL_ADMIN_PW } = process.env;
const rows = []; const leaks = new Set();
const FORBID = /passwordHash|password_hash|tokenHash|sessionToken|storageKey|"sha256"|node_modules|PrismaClient|\bat \S+ \(|stack"|BEGIN |argon2/i;
const known = []; // documented, understood behaviours that are reported but do not fail the run (see docs/qa/BUG_REGISTER.md)
const knownIssue = (id, description, stillPresent, extra = "") => known.push({ id, description, stillPresent, extra });
const check = (op, name, ok, extra = "") => { rows.push({ op, name, ok }); if (!ok) console.log(`FAIL  [${op}] ${name}${extra ? "  -> " + extra : ""}`); };

class S {
  jar = {};
  async req(method, path, { body, raw, headers = {}, origin = O, csrf = true } = {}) {
    const h = { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; "), ...headers }; if (origin) h.origin = origin;
    if (csrf && this.jar["XSRF-TOKEN"] && method !== "GET") h["x-csrf-token"] = this.jar["XSRF-TOKEN"];
    if (body !== undefined) h["content-type"] = "application/json";
    const r = await fetch(A + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: "manual" });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); if (v) this.jar[kv.slice(0, i)] = v; else delete this.jar[kv.slice(0, i)]; }
    const buf = Buffer.from(await r.arrayBuffer()); const text = buf.toString("utf8"); let json; try { json = JSON.parse(text); } catch {}
    if (FORBID.test(text) && !/attachment/i.test(path)) leaks.add(`${method} ${path}: ${(FORBID.exec(text) ?? [""])[0]}`);
    return { status: r.status, json, text, headers: r.headers };
  }
}
const mk = async (email, pw) => { const s = new S(); const r = await s.req("POST", "/auth/login", { body: { email, password: pw } }); if (r.status !== 200) throw new Error("login " + email); return s; };
const a1 = await mk("synthetic.author1@example.test", BL_AUTHOR_PW), a2 = await mk("synthetic.author2@example.test", BL_AUTHOR_PW), ad = await mk("admin@example.test", BL_ADMIN_PW), anon = new S();
const parse = (schema, json) => { const r = schema.safeParse(json); return r.success ? "" : JSON.stringify(r.error.issues[0]).slice(0, 160); };
const isErr = (r, st) => r.status === st && !parse(C.apiErrorSchema, r.json);

// ---- fixtures
const books1 = (await a1.req("GET", "/author/books")).json.items, books2 = (await a2.req("GET", "/author/books")).json.items;
const stamp = Date.now();
const tk = (await a1.req("POST", "/author/tickets", { body: { bookId: books1[0].id, subject: `Matrix ticket ${stamp}`, description: "Fixture ticket for the API matrix, long enough to be valid." } })).json.ticket;
const ftk = (await a2.req("POST", "/author/tickets", { body: { bookId: books2[0].id, subject: `Foreign ticket ${stamp}`, description: "Another author's fixture ticket for isolation checks, long enough." } })).json.ticket;
const BAD_IDS = ["doesnotexist", "../../etc/passwd", "'; DROP TABLE \"Ticket\";--", "x".repeat(300), "%00", "0"];

// ---- GET /healthz
let r = await fetch(O + "/healthz"); check("GET /healthz", "200 {status:ok}", r.status === 200 && (await r.json()).status === "ok");
r = await fetch(O + "/healthz", { method: "POST" }); check("GET /healthz", "POST not allowed (404)", r.status === 404);

// ---- POST /auth/login
for (const [n, body, st] of [["missing body", undefined, 400], ["empty object", {}, 400], ["email not a string", { email: 5, password: "x" }, 400], ["invalid email", { email: "nope", password: "x" }, 400], ["empty password", { email: "a@b.test", password: "" }, 400], ["wrong password", { email: "synthetic.author1@example.test", password: "wrong-password-1" }, 401], ["unknown user", { email: "nobody@example.test", password: "wrong-password-1" }, 401]]) {
  const x = await new S().req("POST", "/auth/login", { body }); check("POST /auth/login", n, isErr(x, st), `status ${x.status}`);
}
let x = await new S().req("POST", "/auth/login", { body: { email: "SYNTHETIC.Author1@Example.TEST", password: BL_AUTHOR_PW } }); check("POST /auth/login", "email is case-insensitive", x.status === 200 && !parse(C.loginResponseSchema, x.json), parse(C.loginResponseSchema, x.json));
x = await new S().req("POST", "/auth/login", { body: { email: "  synthetic.author1@example.test ", password: BL_AUTHOR_PW } }); knownIssue("BUG-001", "login rejects an email with surrounding whitespace (400) although the server trims after validating", x.status === 400, `status ${x.status}`);
x = await new S().req("POST", "/auth/login", { body: { email: "synthetic.author1@example.test", password: BL_AUTHOR_PW }, origin: "https://evil.example" }); check("POST /auth/login", "foreign Origin rejected (login CSRF)", x.status === 403);
x = await new S().req("POST", "/auth/login", { raw: "{not json", headers: { "content-type": "application/json" } }); check("POST /auth/login", "malformed JSON -> 400 error contract", isErr(x, 400));
x = await new S().req("POST", "/auth/login", { raw: "email=a&password=b", headers: { "content-type": "application/x-www-form-urlencoded" } }); check("POST /auth/login", "form-encoded body rejected", x.status === 400 || x.status === 415);
x = await new S().req("POST", "/auth/login", { body: { email: "synthetic.author1@example.test", password: BL_AUTHOR_PW, role: "ADMIN", isAdmin: true } }); check("POST /auth/login", "extra privilege fields cannot elevate role", x.status === 200 && x.json?.user?.role === "AUTHOR");

// ---- GET /auth/me, POST /auth/logout
x = await anon.req("GET", "/auth/me"); check("GET /auth/me", "anonymous 401", isErr(x, 401));
x = await a1.req("GET", "/auth/me"); check("GET /auth/me", "matches contract", x.status === 200 && !parse(C.meResponseSchema, x.json), parse(C.meResponseSchema, x.json));
check("GET /auth/me", "response has no password/hash fields", !/hash|password/i.test(x.text));
x = await anon.req("POST", "/auth/logout"); check("POST /auth/logout", "anonymous 401", isErr(x, 401));
const tmp = await mk("synthetic.author6@example.test", BL_AUTHOR_PW); x = await tmp.req("POST", "/auth/logout", { csrf: false }); check("POST /auth/logout", "missing CSRF token 403", isErr(x, 403));
x = await tmp.req("POST", "/auth/logout"); check("POST /auth/logout", "valid logout 204", x.status === 204);

// ---- GET /author/books(+:id)
x = await anon.req("GET", "/author/books"); check("GET /author/books", "anonymous 401", isErr(x, 401));
x = await ad.req("GET", "/author/books"); check("GET /author/books", "admin (no author profile) 403", isErr(x, 403), `status ${x.status}`);
x = await a1.req("GET", "/author/books"); check("GET /author/books", "matches contract", !parse(C.bookListResponseSchema, x.json), parse(C.bookListResponseSchema, x.json));
for (const q of ["page=0", "page=abc", "pageSize=0", "pageSize=100000", "unknown=1", "page=-1"]) { x = await a1.req("GET", "/author/books?" + q); check("GET /author/books", `invalid query ${q} -> 400`, isErr(x, 400), `status ${x.status}`); }
x = await a1.req("GET", `/author/books/${books1[0].id}`); check("GET /author/books/:id", "own book matches contract", x.status === 200 && !parse(C.bookSchema, x.json.book ?? x.json), parse(C.bookSchema, x.json?.book ?? x.json));
x = await a1.req("GET", `/author/books/${books2[0].id}`); check("GET /author/books/:id", "other author's book 404", isErr(x, 404));
for (const id of BAD_IDS) { x = await a1.req("GET", `/author/books/${encodeURIComponent(id)}`); check("GET /author/books/:id", `malformed id ${JSON.stringify(id.slice(0, 20))} -> 4xx, never 5xx`, x.status >= 400 && x.status < 500, `status ${x.status}`); }

// ---- POST/GET /author/tickets
x = await anon.req("POST", "/author/tickets", { body: {} }); check("POST /author/tickets", "anonymous 401", x.status === 401);
for (const [n, body] of [["empty object", {}], ["subject too short", { bookId: null, subject: "ab", description: "long enough description here" }], ["description too short", { bookId: null, subject: "Valid subject", description: "short" }], ["subject 201 chars", { bookId: null, subject: "s".repeat(201), description: "long enough description here" }], ["description 10001 chars", { bookId: null, subject: "Valid subject", description: "d".repeat(10001) }], ["bookId wrong type", { bookId: 5, subject: "Valid subject", description: "long enough description here" }]]) { x = await a1.req("POST", "/author/tickets", { body }); check("POST /author/tickets", `${n} -> 400`, isErr(x, 400), `status ${x.status}`); }
x = await a1.req("POST", "/author/tickets", { body: { bookId: "nonexistentbook", subject: "Valid subject", description: "long enough description here" } }); check("POST /author/tickets", "nonexistent bookId -> 4xx", x.status >= 400 && x.status < 500, `status ${x.status}`);
x = await a1.req("POST", "/author/tickets", { body: { bookId: books2[0].id, subject: "Valid subject", description: "long enough description here" } }); check("POST /author/tickets", "another author's bookId -> 404 (no IDOR)", isErr(x, 404), `status ${x.status}`);
x = await a1.req("POST", "/author/tickets", { body: { bookId: null, subject: "General ticket " + stamp, description: "A general ticket without a book, long enough.", status: "CLOSED", priority: "CRITICAL", assigneeId: "x", authorId: "x" } });
check("POST /author/tickets", "general ticket (bookId null) matches contract", x.status === 201 && !parse(C.ticketResponseSchema, x.json), parse(C.ticketResponseSchema, x.json));
check("POST /author/tickets", "mass-assignment ignored (status OPEN, priority/assignee unset)", x.json?.ticket?.status === "OPEN" && !x.json?.ticket?.priority && !x.json?.ticket?.assigneeId, JSON.stringify([x.json?.ticket?.status, x.json?.ticket?.priority, x.json?.ticket?.assigneeId]));
const dupBody = { bookId: books1[0].id, subject: `Duplicate submit ${stamp}`, description: "Submitted twice in quick succession to test duplicate handling." };
const [d1, d2] = await Promise.all([a1.req("POST", "/author/tickets", { body: dupBody }), a1.req("POST", "/author/tickets", { body: dupBody })]);
const dupOk = (d1.json?.ticket?.id && d1.json.ticket.id === d2.json?.ticket?.id) || [d1.status, d2.status].some((s) => s === 409);
knownIssue("BUG-002", "two concurrent identical POST /author/tickets create two tickets (the UI sends one request on a double click)", !dupOk, `statuses ${d1.status}/${d2.status}`);
x = await a1.req("GET", "/author/tickets"); check("GET /author/tickets", "matches contract", !parse(C.ticketListResponseSchema, x.json), parse(C.ticketListResponseSchema, x.json));
for (const q of ["status=BOGUS", "priority=HIGHEST", "category=x", "page=0", "authorId=other", "from=notadate", "from=2030-01-01&to=2020-01-01"]) { x = await a1.req("GET", "/author/tickets?" + q); check("GET /author/tickets", `invalid query ${q} -> 400`, isErr(x, 400), `status ${x.status}`); }
x = await a1.req("GET", "/author/tickets?status=OPEN&pageSize=5"); check("GET /author/tickets", "status filter + pageSize respected", x.status === 200 && x.json.items.length <= 5 && x.json.items.every((t) => t.status === "OPEN"));
check("GET /author/tickets", "list never contains another author's ticket", !JSON.stringify((await a1.req("GET", "/author/tickets?pageSize=100")).json).includes(ftk.id));

// ---- GET /author/tickets/:id, messages
x = await a1.req("GET", `/author/tickets/${tk.id}`); check("GET /author/tickets/:id", "own ticket matches contract", !parse(C.ticketDetailResponseSchema, x.json), parse(C.ticketDetailResponseSchema, x.json));
check("GET /author/tickets/:id", "no internal notes / audit / AI analysis keys in author payload", !/internalNote|auditLog|aiAnalysis|rationale|draftResponse/i.test(x.text));
x = await a1.req("GET", `/author/tickets/${ftk.id}`); check("GET /author/tickets/:id", "foreign ticket 404", isErr(x, 404));
x = await ad.req("GET", `/author/tickets/${tk.id}`); check("GET /author/tickets/:id", "admin on author route 403", isErr(x, 403), `status ${x.status}`);
for (const id of BAD_IDS) { x = await a1.req("GET", `/author/tickets/${encodeURIComponent(id)}`); check("GET /author/tickets/:id", `malformed id ${JSON.stringify(id.slice(0, 20))} -> 4xx`, x.status >= 400 && x.status < 500, `status ${x.status}`); }
for (const [n, body, st] of [["empty body", {}, 400], ["blank text", { body: "   " }, 400], ["10001 chars", { body: "m".repeat(10001) }, 400], ["wrong type", { body: 7 }, 400]]) { x = await a1.req("POST", `/author/tickets/${tk.id}/messages`, { body }); check("POST /author/tickets/:id/messages", `${n} -> ${st}`, isErr(x, st), `status ${x.status}`); }
x = await a1.req("POST", `/author/tickets/${ftk.id}/messages`, { body: { body: "intrusion attempt" } }); check("POST /author/tickets/:id/messages", "reply to foreign ticket 404", isErr(x, 404));
x = await a1.req("POST", `/author/tickets/${tk.id}/messages`, { body: { body: `Matrix reply ${stamp}`, visibility: "INTERNAL", authorId: "x" } }); check("POST /author/tickets/:id/messages", "valid reply matches contract", x.status === 201 && !parse(C.ticketMessageResponseSchema, x.json), parse(C.ticketMessageResponseSchema, x.json));
check("POST /author/tickets/:id/messages", "author cannot post INTERNAL/forged-author messages", x.json?.message?.visibility !== "INTERNAL" && x.json?.message?.sender !== "ADMIN");
x = await a1.req("GET", `/author/tickets/${tk.id}/attachments`); check("GET .../attachments (author)", "list matches contract", x.status === 200 && !parse(C.attachmentListResponseSchema, x.json), parse(C.attachmentListResponseSchema, x.json));
x = await a1.req("GET", `/author/tickets/${ftk.id}/attachments`); check("GET .../attachments (author)", "foreign ticket 404", isErr(x, 404));
x = await a1.req("GET", `/author/tickets/${tk.id}/attachments/doesnotexist`); check("GET .../attachments/:id (author)", "nonexistent 404", isErr(x, 404));
x = await a1.req("POST", `/author/tickets/${tk.id}/attachments`, { raw: "x", headers: { "content-type": "text/plain" } }); check("POST .../attachments (author)", "missing filename query -> 400", isErr(x, 400), `status ${x.status}`);

// ---- admin
x = await anon.req("GET", "/admin/tickets"); check("GET /admin/tickets", "anonymous 401", isErr(x, 401));
x = await a1.req("GET", "/admin/tickets"); check("GET /admin/tickets", "author 403", isErr(x, 403));
x = await ad.req("GET", "/admin/tickets?pageSize=100"); check("GET /admin/tickets", "matches contract", !parse(C.adminQueueResponseSchema, x.json), parse(C.adminQueueResponseSchema, x.json));
for (const q of ["page=0", "pageSize=101", "status=BOGUS", "q=search", "unknown=1", "from=x"]) { x = await ad.req("GET", "/admin/tickets?" + q); check("GET /admin/tickets", `invalid query ${q} -> 400`, isErr(x, 400), `status ${x.status}`); }
x = await ad.req("GET", `/admin/tickets/${tk.id}`); check("GET /admin/tickets/:id", "matches contract", !parse(C.adminTicketDetailResponseSchema, x.json), parse(C.adminTicketDetailResponseSchema, x.json));
x = await ad.req("GET", `/admin/tickets/doesnotexist`); check("GET /admin/tickets/:id", "nonexistent 404", isErr(x, 404));
for (const id of BAD_IDS) { x = await ad.req("GET", `/admin/tickets/${encodeURIComponent(id)}`); check("GET /admin/tickets/:id", `malformed id ${JSON.stringify(id.slice(0, 20))} -> 4xx`, x.status >= 400 && x.status < 500, `status ${x.status}`); }
for (const [n, body, st] of [["empty object", {}, 400], ["bad status", { status: "DONE" }, 400], ["bad priority", { priority: "URGENT" }, 400], ["bad category", { category: "OTHER" }, 400], ["unknown field only", { assigneeId: "x" }, 400]]) { x = await ad.req("PATCH", `/admin/tickets/${tk.id}`, { body }); check("PATCH /admin/tickets/:id", `${n} -> ${st}`, isErr(x, st), `status ${x.status}`); }
x = await ad.req("PATCH", `/admin/tickets/doesnotexist`, { body: { priority: "LOW" } }); check("PATCH /admin/tickets/:id", "nonexistent 404", isErr(x, 404));
x = await a1.req("PATCH", `/admin/tickets/${tk.id}`, { body: { priority: "LOW" } }); check("PATCH /admin/tickets/:id", "author 403", isErr(x, 403));
x = await ad.req("PATCH", `/admin/tickets/${tk.id}`, { body: { priority: "HIGH", category: "ROYALTY_PAYMENTS" } }); check("PATCH /admin/tickets/:id", "valid change matches contract", x.status === 200 && !parse(C.ticketResponseSchema, x.json), parse(C.ticketResponseSchema, x.json));
x = await ad.req("PATCH", `/admin/tickets/${tk.id}`, { body: { priority: "HIGH" } }); check("PATCH /admin/tickets/:id", "idempotent repeat of same value is OK", x.status === 200, `status ${x.status}`);
for (const [n, body] of [["empty", {}], ["blank", { body: " " }], ["10001 chars", { body: "r".repeat(10001) }]]) { x = await ad.req("POST", `/admin/tickets/${tk.id}/replies`, { body }); check("POST /admin/.../replies", `${n} -> 400`, isErr(x, 400), `status ${x.status}`); x = await ad.req("POST", `/admin/tickets/${tk.id}/internal-notes`, { body }); check("POST /admin/.../internal-notes", `${n} -> 400`, isErr(x, 400), `status ${x.status}`); }
x = await ad.req("POST", `/admin/tickets/doesnotexist/replies`, { body: { body: "x" } }); check("POST /admin/.../replies", "nonexistent ticket 404", isErr(x, 404));
x = await ad.req("POST", `/admin/tickets/doesnotexist/internal-notes`, { body: { body: "x" } }); check("POST /admin/.../internal-notes", "nonexistent ticket 404", isErr(x, 404));
x = await a1.req("POST", `/admin/tickets/${tk.id}/internal-notes`, { body: { body: "author tries a note" } }); check("POST /admin/.../internal-notes", "author 403", isErr(x, 403));
x = await ad.req("POST", `/admin/tickets/${tk.id}/internal-notes`, { body: { body: `matrix note ${stamp}` } }); check("POST /admin/.../internal-notes", "matches contract", x.status === 201 && !parse(C.internalNoteResponseSchema, x.json), parse(C.internalNoteResponseSchema, x.json));
x = await ad.req("POST", `/admin/tickets/${tk.id}/replies`, { body: { body: `matrix admin reply ${stamp}` } }); check("POST /admin/.../replies", "matches contract", x.status === 201 && !parse(C.ticketMessageResponseSchema, x.json), parse(C.ticketMessageResponseSchema, x.json));
const adminId = (await ad.req("GET", "/auth/me")).json.user.id;
for (const [n, body, st] of [["empty object", {}, 400], ["assigneeId wrong type", { assigneeId: 5 }, 400], ["assign to someone else", { assigneeId: "someoneelse" }, 403]]) { x = await ad.req("PUT", `/admin/tickets/${tk.id}/assignment`, { body }); check("PUT /admin/.../assignment", `${n} -> ${st}`, isErr(x, st), `status ${x.status}`); }
x = await ad.req("PUT", `/admin/tickets/${tk.id}/assignment`, { body: { assigneeId: adminId } }); check("PUT /admin/.../assignment", "assign to self matches contract", x.status === 200 && !parse(C.assignmentResponseSchema, x.json), parse(C.assignmentResponseSchema, x.json));
x = await ad.req("PUT", `/admin/tickets/${tk.id}/assignment`, { body: { assigneeId: null } }); check("PUT /admin/.../assignment", "unassign (null) OK", x.status === 200, `status ${x.status}`);
x = await ad.req("PUT", `/admin/tickets/doesnotexist/assignment`, { body: { assigneeId: adminId } }); check("PUT /admin/.../assignment", "nonexistent ticket 404", isErr(x, 404));
x = await a1.req("PUT", `/admin/tickets/${tk.id}/assignment`, { body: { assigneeId: null } }); check("PUT /admin/.../assignment", "author 403", isErr(x, 403));
x = await ad.req("GET", `/admin/tickets/${ftk.id}/ai-analysis`); check("GET /admin/.../ai-analysis", "ticket without analysis -> 404 or contract-valid empty", x.status === 404 || (x.status === 200 && !parse(C.aiAnalysisResponseSchema, x.json)), `status ${x.status}`);
x = await ad.req("POST", `/admin/tickets/doesnotexist/ai-analysis`, { body: {} }); check("POST /admin/.../ai-analysis", "nonexistent ticket 404", isErr(x, 404));
x = await a1.req("POST", `/admin/tickets/${tk.id}/ai-analysis`, { body: {} }); check("POST /admin/.../ai-analysis", "author 403", isErr(x, 403));
x = await ad.req("POST", `/admin/tickets/${tk.id}/ai-analysis`, { body: {} }); check("POST /admin/.../ai-analysis", "request matches contract", [200, 202].includes(x.status) && !parse(C.aiAnalysisRequestResponseSchema, x.json), parse(C.aiAnalysisRequestResponseSchema, x.json));
const par = await Promise.all(Array.from({ length: 6 }, () => ad.req("POST", `/admin/tickets/${tk.id}/ai-analysis`, { body: {} })));
const ids = new Set(par.map((p) => p.json?.analysis?.id)); check("POST /admin/.../ai-analysis", "6 concurrent requests collapse to one attempt (single-flight/cooldown)", ids.size === 1 && par.every((p) => [200, 202].includes(p.status)), `distinct attempts=${ids.size}`);
x = await ad.req("GET", `/admin/tickets/${tk.id}/attachments`); check("GET /admin/.../attachments", "matches contract", x.status === 200 && !parse(C.attachmentListResponseSchema, x.json));
x = await ad.req("GET", `/admin/tickets/doesnotexist/attachments`); check("GET /admin/.../attachments", "nonexistent ticket 404", isErr(x, 404));
x = await ad.req("GET", `/admin/tickets/${tk.id}/attachments/doesnotexist`); check("GET /admin/.../attachments/:id", "nonexistent attachment 404", isErr(x, 404));
x = await a1.req("GET", `/admin/tickets/${tk.id}/attachments`); check("GET /admin/.../attachments", "author 403", isErr(x, 403));

// ---- events
x = await anon.req("GET", "/events/tickets"); check("GET /events/tickets", "anonymous 401", isErr(x, 401));

// ---- unknown routes / methods
for (const [m, p] of [["GET", "/nope"], ["DELETE", "/author/tickets/" + tk.id], ["PUT", "/author/tickets"], ["PATCH", "/author/tickets/" + tk.id]]) { x = await a1.req(m, p); check(`${m} ${p.split("/")[1]}`, `unsupported ${m} ${p.slice(0, 30)} -> 404 JSON contract, no stack`, x.status === 404 && !parse(C.apiErrorSchema, x.json), `status ${x.status}`); }

x = await a1.req("DELETE", "/admin/tickets/" + tk.id); check("DELETE admin (as author)", "author calling an unsupported admin method gets 403 (role check first)", isErr(x, 403), `status ${x.status}`);
x = await ad.req("DELETE", "/admin/tickets/" + tk.id); check("DELETE admin (as admin)", "unsupported DELETE -> 404 JSON contract, no stack", x.status === 404 && !parse(C.apiErrorSchema, x.json), `status ${x.status}`);

const bad = rows.filter((r) => !r.ok);
const byOp = {}; for (const r of rows) (byOp[r.op] ??= { p: 0, f: 0 })[r.ok ? "p" : "f"]++;
console.log("\nper-operation results:"); for (const [op, v] of Object.entries(byOp)) console.log(`  ${v.f ? "FAIL" : "ok  "} ${op.padEnd(36)} ${v.p}/${v.p + v.f}`);
console.log(`\nresponse bodies scanned for secrets/stack traces: ${leaks.size ? "LEAKS: " + [...leaks].join("; ") : "no leaks found"}`);
for (const k of known) console.log(`${k.stillPresent ? "KNOWN-ISSUE" : "FIXED      "} ${k.id}: ${k.description}${k.extra ? " (" + k.extra + ")" : ""}`);
console.log(`${rows.length - bad.length}/${rows.length} API matrix checks passed; ${known.filter((k) => k.stillPresent).length} known issue(s) still present`);
process.exitCode = bad.length ? 1 : 0;
