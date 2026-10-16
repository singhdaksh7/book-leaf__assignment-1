// One AI classification+draft round trip through the PUBLIC https URL. Prints one line. Never prints credentials.
const O = (process.env.BASE_URL ?? "https://bookleaf.77.37.45.177.sslip.io").replace(/\/+$/, ""), A = O + "/api/v1";
const login = async (email, password) => {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(A + "/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: O }, body: JSON.stringify({ email, password }) });
      if (r.status === 200) { const ck = r.headers.getSetCookie().map((x) => x.split(";")[0]); return { c: ck.join("; "), x: ck.find((v) => v.startsWith("XSRF")).split("=")[1] }; }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("login unavailable");
};
const au = await login("synthetic.author1@example.test", process.env.BL_AUTHOR_PW), ad = await login("admin@example.test", process.env.BL_ADMIN_PW);
const j = (s) => ({ cookie: s.c, origin: O, "x-csrf-token": s.x, "content-type": "application/json" });
const b = (await (await fetch(A + "/author/books", { headers: { cookie: au.c } })).json()).items[0];
const t = (await (await fetch(A + "/author/tickets", { method: "POST", headers: j(au), body: JSON.stringify({ bookId: b.id, subject: `Recovery probe ${process.env.LABEL ?? ""} ${Date.now()}`, description: "I have not received my royalty payment in my bank account yet, please check." }) })).json()).ticket;
await fetch(A + `/admin/tickets/${t.id}/ai-analysis`, { method: "POST", headers: j(ad), body: "{}" });
let s; for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 700)); s = (await (await fetch(A + `/admin/tickets/${t.id}/ai-analysis`, { headers: { cookie: ad.c } })).json()).analysis; if (s.status !== "PENDING") break; }
const a = s.analysis ?? {};
const ok = s.status === "COMPLETED" && a.category === "ROYALTY_PAYMENTS" && /\[DEMO MOCK/.test(a.rationale ?? "") && /\[DEMO DRAFT/.test(a.draftResponse ?? "");
console.log(`${ok ? "OK  " : "FAIL"} status=${s.status} error=${s.errorCode ?? "-"} category=${a.category ?? "-"} labels=${/\[DEMO MOCK/.test(a.rationale ?? "") && /\[DEMO DRAFT/.test(a.draftResponse ?? "")}`);
process.exit(ok ? 0 : 1);
