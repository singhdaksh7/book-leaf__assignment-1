// Bounded live acceptance against a deployed BookLeaf running the REAL OpenRouter provider (no demo mock).
// Creates SYNTHETIC tickets only (subject prefix "[REAL-AI SMOKE]"), one per category (about 12 model calls), and walks the whole workflow:
// login, ticket + attachment, assignment, internal note, real AI classification + draft, admin edit + explicit send, author receives it, SSE, logout.
//
//   BL_AUTHOR_PW=... BL_ADMIN_PW=... [AUTHOR_EMAIL=synthetic.author2@example.test] [BASE_URL=https://...] node tests/live/real-ai-smoke.mjs
// Passwords are never printed. Exit 0 = every hard check passed; a rejected draft (labelled rule-based fallback) is reported but is not a failure,
// because strict grounding may legitimately reject a non-deterministic model output. Provider quota exhaustion is reported, never masked.
const ORIGIN = (process.env.BASE_URL ?? "https://bookleaf.77.37.45.177.sslip.io").replace(/\/+$/, "");
const API = ORIGIN + "/api/v1";
const { BL_AUTHOR_PW, BL_ADMIN_PW } = process.env;
if (!BL_AUTHOR_PW || !BL_ADMIN_PW) { console.log("BLOCKED: set BL_AUTHOR_PW and BL_ADMIN_PW"); process.exit(2); }
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`); };
const info = (s) => console.log("INFO  " + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  jar = {};
  headers(method, extra = {}) {
    const h = { origin: ORIGIN, cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; "), ...extra };
    if (this.jar["XSRF-TOKEN"] && method !== "GET") h["x-csrf-token"] = this.jar["XSRF-TOKEN"];
    return h;
  }
  keep(r) { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); this.jar[kv.slice(0, i)] = kv.slice(i + 1); } }
  async req(method, path, body, raw) {
    const h = this.headers(method, raw ? raw.headers : body !== undefined ? { "content-type": "application/json" } : {});
    const r = await fetch(API + path, { method, headers: h, body: raw ? raw.body : body !== undefined ? JSON.stringify(body) : undefined });
    this.keep(r);
    const buf = Buffer.from(await r.arrayBuffer());
    let json; try { json = JSON.parse(buf.toString("utf8")); } catch {}
    return { status: r.status, json, buf, headers: r.headers };
  }
}
const author = new Client(), admin = new Client();
const AUTHOR_EMAIL = process.env.AUTHOR_EMAIL ?? "synthetic.author2@example.test";

// 1 x 1 PNG (valid magic bytes)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let r = await author.req("POST", "/auth/login", { email: AUTHOR_EMAIL, password: BL_AUTHOR_PW });
check("1 author login", r.status === 200 && r.json?.user?.role === "AUTHOR");
r = await admin.req("POST", "/auth/login", { email: "admin@example.test", password: BL_ADMIN_PW });
check("2 admin login", r.status === 200 && r.json?.user?.role === "ADMIN");
check("2b session cookie is HttpOnly + Secure", /HttpOnly/i.test(r.headers.get("set-cookie") ?? "") && /Secure/i.test(r.headers.get("set-cookie") ?? ""));
const adminId = (await admin.req("GET", "/auth/me")).json.user.id;
const books = (await author.req("GET", "/author/books")).json.items;
check("author sees own books", Array.isArray(books) && books.length > 0, `${books?.length} books`);

// SSE: author subscribes before the admin acts; expect a live event for the admin reply.
const sseEvents = [];
const sseAbort = new AbortController();
(async () => {
  try {
    const resp = await fetch(API + "/events/tickets", { headers: author.headers("GET", { accept: "text/event-stream" }), signal: sseAbort.signal });
    if (resp.status !== 200) { sseEvents.push(`HTTP ${resp.status}`); return; }
    const dec = new TextDecoder(); let buf = "";
    for await (const chunk of resp.body) {
      buf += dec.decode(chunk, { stream: true });
      let i; while ((i = buf.indexOf("\n\n")) >= 0) { const frame = buf.slice(0, i); buf = buf.slice(i + 2); const m = /^event: (.+)$/m.exec(frame); if (m) sseEvents.push(m[1]); }
    }
  } catch { /* aborted */ }
})();
await sleep(1500);

const cases = [
  ["ROYALTY_PAYMENTS", "Royalty not received", "I published my book four months ago and still have not received any royalty payment in my bank account. Can you check?"],
  ["ISBN_METADATA", "Different ISBN on Amazon", "The ISBN shown on Amazon is different from the ISBN printed on my physical copy. Please fix the metadata."],
  ["PRINTING_QUALITY", "Pages are faded", "My printed copies arrived with faded ink and several pages that are misaligned. I need this corrected."],
  ["DISTRIBUTION_AVAILABILITY", "Not on Flipkart", "My book is not available on Flipkart or any other online store even though it was marked as published."],
  ["BOOK_STATUS_PRODUCTION", "Status of my book", "What is the current production status of my book and when will the cover design stage be complete?"],
  ["GENERAL_INQUIRY", "Question about the portal", "Hello, how do I update my author biography and profile photo shown on the portal?"]
];
const stamp = Date.now();
const summary = [];
let firstTicket;
const countBefore = (await author.req("GET", "/author/tickets?pageSize=100")).json?.total;

async function awaitAnalysis(ticketId, ms = 60000) {
  const end = Date.now() + ms; let a;
  while (Date.now() < end) {
    a = (await admin.req("GET", `/admin/tickets/${ticketId}/ai-analysis`)).json?.analysis;
    if (a && a.status !== "PENDING") return a;
    await sleep(1000);
  }
  return a;
}

for (const [want, subject, description] of cases) {
  const c = await author.req("POST", "/author/tickets", { bookId: books[0].id, subject: `[REAL-AI SMOKE] ${subject} ${stamp}`, description });
  const t = c.json?.ticket;
  check(`[${want}] 3 author creates ticket`, c.status === 201 && !!t?.id, `http=${c.status}`);
  if (!t?.id) continue;
  firstTicket ??= t.id;
  const before = (await author.req("GET", `/author/tickets/${t.id}`)).json;
  const a = await awaitAnalysis(t.id);   // created with the ticket; no manual trigger so only one attempt is spent
  const an = a?.analysis ?? {};
  const draft = an.draftResponse ?? "";
  const fallback = /^\[Rule-based fallback/.test(an.rationale ?? "");
  check(`[${want}] 7 real AI analysis COMPLETED`, a?.status === "COMPLETED", `status=${a?.status} errorCode=${a?.errorCode ?? "-"}`);
  if (a?.status === "FAILED") info(`[${want}] provider/validation failure recorded as ${a.errorCode} (not replaced by mock)`);
  check(`[${want}] classification correct`, an.category === want, `got=${an.category} priority=${an.priority} confidence=${an.confidence}`);
  check(`[${want}] not demo-mock output`, !/\[DEMO (MOCK|DRAFT)/.test(JSON.stringify(a ?? {})));
  check(`[${want}] 8 draft present, placeholder resolved, human review flag`, draft.length > 40 && !draft.includes("{{") && an.requiresHumanReview === true);
  info(`[${want}] draft source: ${a?.status !== "COMPLETED" ? "none (attempt " + a?.status + ")" : fallback ? "RULE-BASED FALLBACK (model output rejected by strict grounding)" : "model, passed strict grounding"}`);
  const after = (await author.req("GET", `/author/tickets/${t.id}`)).json;
  check(`[${want}] 10 nothing auto-sent; author cannot see AI content`, (after.messages?.length ?? 0) === (before.messages?.length ?? 0) && !JSON.stringify(after).includes(draft.slice(0, 30) || "§§"), `messages ${before.messages?.length}->${after.messages?.length}`);
  summary.push({ want, status: a?.status, got: an.category, fallback });

  if (want === "ROYALTY_PAYMENTS") {
    // attachment (author uploads, admin downloads identical bytes)
    const up = await author.req("POST", `/author/tickets/${t.id}/attachments?filename=smoke.png`, undefined, { headers: { "content-type": "image/png" }, body: PNG });
    check("5 attachment upload", up.status === 201, `http=${up.status}`);
    const list = (await admin.req("GET", `/admin/tickets/${t.id}/attachments`)).json;
    const att = (list?.items ?? list?.attachments ?? [])[0];
    const dl = att ? await admin.req("GET", `/admin/tickets/${t.id}/attachments/${att.id}`) : null;
    check("5b admin downloads identical bytes, forced download", !!dl && dl.status === 200 && Buffer.compare(dl.buf, PNG) === 0 && /attachment/i.test(dl.headers.get("content-disposition") ?? ""));
    // assignment + internal note
    const asg = await admin.req("PUT", `/admin/tickets/${t.id}/assignment`, { assigneeId: adminId });
    check("6 ticket assignment to admin", asg.status === 200, `http=${asg.status}`);
    const note = await admin.req("POST", `/admin/tickets/${t.id}/internal-notes`, { body: "Synthetic smoke-test internal note." });
    check("6b internal note (admin only)", note.status === 201 && !JSON.stringify((await author.req("GET", `/author/tickets/${t.id}`)).json).includes("smoke-test internal note"));
    // admin reviews, edits, explicitly sends
    const edited = (draft || "Dear Synthetic,\n\nThank you for writing. Our team will review and follow up.\n\nWarm regards,\nBookLeaf Author Support").replace("Dear Synthetic Author", "Dear Synthetic") + "\n\n(Reviewed and edited by the admin during the smoke test.)";
    const sent = await admin.req("POST", `/admin/tickets/${t.id}/replies`, { body: edited });
    check("9 admin edits the draft and sends explicitly", sent.status === 201, `http=${sent.status}`);
    const seen = JSON.stringify((await author.req("GET", `/author/tickets/${t.id}`)).json);
    check("11 author receives the approved reply", seen.includes("Reviewed and edited by the admin"));
    const st = await admin.req("PATCH", `/admin/tickets/${t.id}`, { status: "IN_PROGRESS" });
    check("status change OPEN -> IN_PROGRESS", st.status === 200, `http=${st.status}`);
  }
}

await sleep(2500);
sseAbort.abort();
check("12 SSE delivered live events to the author", sseEvents.some((e) => /^ticket\./.test(e)), `events=${[...new Set(sseEvents)].join(",") || "none"}`);
const countAfter = (await author.req("GET", "/author/tickets?pageSize=100")).json?.total;
check("13 dashboard/list count increased by the tickets created", countAfter - countBefore === cases.length, `${countBefore} -> ${countAfter}`);
r = await author.req("GET", `/author/tickets/${firstTicket}`);
check("14 persistence: first ticket readable with the admin reply", r.status === 200 && (r.json.messages?.length ?? 0) >= 1);
r = await author.req("POST", "/auth/logout", {});
check("16 author logout", r.status === 200 || r.status === 204);
check("16b session invalid after logout", (await author.req("GET", "/auth/me")).status === 401);
await admin.req("POST", "/auth/logout", {});

const ok = summary.filter((s) => s.status === "COMPLETED" && s.got === s.want).length;
const model = summary.filter((s) => !s.fallback && s.status === "COMPLETED").length;
console.log(`\nSummary: ${ok}/${cases.length} correctly classified, ${model}/${cases.length} drafts from the model (rest rule-based fallback or failed)`);
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
