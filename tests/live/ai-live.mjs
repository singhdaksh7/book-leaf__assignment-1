// Drives the AI workflow through the HTTP API. AUTHOR_EMAIL overrides the author (each author may create 30 tickets per hour; this script creates 6). Works against staging (https) or a local container (BASE/ORIGIN env).
const ORIGIN = (process.env.ORIGIN ?? process.env.BASE_URL ?? "https://bookleaf.77.37.45.177.sslip.io").replace(/\/+$/, "");
const API = (process.env.BASE ?? ORIGIN) + "/api/v1";
const { BL_AUTHOR_PW, BL_ADMIN_PW } = process.env;
const FAIL_MODE = process.env.FAIL_MODE; // "stop" -> expects the caller to have stopped the provider
const res_ = [];
const check = (n, ok, x = "") => { res_.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class C {
  jar = {};
  async req(method, path, body) {
    const h = { origin: ORIGIN, cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; ") };
    if (this.jar["XSRF-TOKEN"] && method !== "GET") h["x-csrf-token"] = this.jar["XSRF-TOKEN"];
    if (body !== undefined) h["content-type"] = "application/json";
    const r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); this.jar[kv.slice(0, i)] = kv.slice(i + 1); }
    let json; try { json = await r.json(); } catch {}
    return { status: r.status, json };
  }
}
const author = new C(), admin = new C();
let r = await author.req("POST", "/auth/login", { email: process.env.AUTHOR_EMAIL ?? "synthetic.author1@example.test", password: BL_AUTHOR_PW });
check("author login", r.status === 200);
r = await admin.req("POST", "/auth/login", { email: "admin@example.test", password: BL_ADMIN_PW });
check("admin login", r.status === 200);
const adminId = (await admin.req("GET", "/auth/me")).json.user.id;
const books = (await author.req("GET", "/author/books")).json.items;

const cases = [
  ["ROYALTY_PAYMENTS", "Royalty not received", "I published my book 4 months ago and still haven't received any royalty payment. Please check my bank transfer."],
  ["ISBN_METADATA", "Wrong ISBN on my book", "The ISBN shown for my book links to a different title, it looks like a duplicate."],
  ["PRINTING_QUALITY", "Misprint in my author copy", "My author copy arrived with blurry print and the binding is torn."],
  ["DISTRIBUTION_AVAILABILITY", "Book unavailable on Amazon", "My book is showing as unavailable on Amazon and Flipkart listing."],
  ["BOOK_STATUS_PRODUCTION", "Production status update", "What stage is my manuscript in? Is the typesetting or proofreading delayed?"],
  ["GENERAL_INQUIRY", "Question about packages", "Hello, can you tell me a bit about the company and the publishing packages?"]
];

async function awaitAnalysis(ticketId, ms = 30000) {
  const end = Date.now() + ms; let a;
  while (Date.now() < end) {
    const g = await admin.req("GET", `/admin/tickets/${ticketId}/ai-analysis`);
    a = g.json?.analysis ?? g.json?.analyses?.[0] ?? g.json;
    if (a && a.status && a.status !== "PENDING") return a;
    await sleep(700);
  }
  return a;
}

const stamp = Date.now();
let firstTicket;
for (const [want, subject, description] of (FAIL_MODE === "stop" ? [] : cases)) {
  const t = (await author.req("POST", "/author/tickets", { bookId: books[0].id, subject: `${subject} ${stamp}`, description })).json?.ticket;
  firstTicket ??= t.id;
  const before = (await author.req("GET", `/author/tickets/${t.id}`)).json;
  const post = await admin.req("POST", `/admin/tickets/${t.id}/ai-analysis`, {});
  const a = await awaitAnalysis(t.id);
  if (want === "ROYALTY_PAYMENTS") console.log("INFO  analysis fields:", Object.keys(a ?? {}).join(","));
  const an = a?.analysis ?? {};
  if (want === "ROYALTY_PAYMENTS") console.log("INFO  analysis.analysis fields:", Object.keys(an).join(","));
  const draft = an.draftResponse ?? "";
  check(`[${want}] analysis COMPLETED with category`, a?.status === "COMPLETED" && an.category === want, `status=${a?.status} category=${an.category} priority=${an.priority} http=${post.status}`);
  check(`[${want}] [DEMO MOCK] label in rationale`, /\[DEMO MOCK/.test(an.rationale ?? ""));
  check(`[${want}] [DEMO DRAFT] label in draft`, /\[DEMO DRAFT/.test(draft));
  check(`[${want}] draft has no currency amounts / digits-with-rupee`, !/[₹$]|\brs\.?\s?\d|\binr\b/i.test(draft));
  const after = (await author.req("GET", `/author/tickets/${t.id}`)).json;
  const sa = JSON.stringify(after);
  check(`[${want}] author sees NO AI draft/analysis, nothing auto-sent`, !sa.includes("DEMO DRAFT") && !sa.includes("DEMO MOCK") && !/ai[-_]?analysis/i.test(sa) && (after.messages?.length ?? 0) === (before.messages?.length ?? 0), `messages ${before.messages?.length}->${after.messages?.length}`);
  if (want === "ROYALTY_PAYMENTS") {
    // admin review: edit the draft (remove demo label) and send; author then sees only what the admin sent
    const edited = draft.replace(/\[DEMO DRAFT[^\]]*\]\s*/, "").replace("{{authorFirstName}}", "Synthetic");
    const sent = await admin.req("POST", `/admin/tickets/${t.id}/replies`, { body: edited });
    check("admin reviews/edits draft and sends it", sent.status === 201);
    const seen = JSON.stringify((await author.req("GET", `/author/tickets/${t.id}`)).json);
    check("author receives the admin-sent reply (without demo label)", seen.includes("Warm regards") && !seen.includes("DEMO DRAFT"));
  }
}

// Failed AI and manual retry (caller controls provider availability)
if (FAIL_MODE === "stop") {
  const t = (await author.req("POST", "/author/tickets", { bookId: books[0].id, subject: `Retry check ${stamp}`, description: "Royalty payment question for the retry check, please advise on my bank transfer." })).json.ticket;
  await admin.req("POST", `/admin/tickets/${t.id}/ai-analysis`, {});
  const failed = await awaitAnalysis(t.id, 60000);
  check("provider down -> analysis FAILED safely (ticket intact)", failed?.status === "FAILED", `status=${failed?.status} errorCode=${failed?.errorCode}`);
  check("ticket still readable by admin while AI failed", (await admin.req("GET", `/admin/tickets/${t.id}`)).status === 200);
  console.log("RETRY_TICKET=" + t.id);
}
console.log(`\n${res_.filter(Boolean).length}/${res_.length} passed`);
