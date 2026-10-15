// Run with:  npm run test:infra   (node --test "infra/mock-ai/*.test.mjs")
// Starts the real server.mjs as a child process and talks to it over HTTP, using request shapes the real @bookleaf/ai prompts produce.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const server = join(dirname(fileURLToPath(import.meta.url)), "server.mjs");
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test("refuses to start without the demonstration acknowledgement", () => {
  for (const ack of [undefined, "", "yes", "true"]) {
    const r = spawnSync(process.execPath, [server], { env: { ...process.env, MOCK_AI_ACK: ack ?? "" }, encoding: "utf8", timeout: 5000 });
    assert.equal(r.status, 1, `ack=${JSON.stringify(ack)}`);
    assert.match(r.stderr, /refusing to start/);
  }
});

describe("running mock", () => {
  let child, port, base;
  before(async () => {
    port = await freePort(); base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [server], { env: { ...process.env, MOCK_AI_ACK: "demonstration-only", MOCK_AI_PORT: String(port), PORT: "3000" }, stdio: ["ignore", "pipe", "inherit"] });
    for (let i = 0; i < 50; i++) { try { if ((await fetch(base + "/healthz")).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    throw new Error("mock did not start");
  });
  after(() => child?.kill());

  const call = async (messages) => {
    const r = await fetch(`${base}/api/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages }) });
    assert.equal(r.status, 200);
    const body = await r.json();
    return { body, content: JSON.parse(body.choices[0].message.content) };
  };
  const classify = (text, offered = []) => call([
    { role: "system", content: "You triage support tickets for BookLeaf Publishing." },
    { role: "user", content: `KB: ${offered.join(" ")} royalty payout isbn print amazon\n<untrusted-ab12 kind="ticket">${text}</untrusted-ab12>` }
  ]);
  const draft = (label, offered = []) => call([
    { role: "system", content: "You draft replies for BookLeaf Publishing's author support team." },
    { role: "user", content: `TICKET CLASSIFICATION (system): ${label}, priority HIGH\nKB: ${offered.join(" ")}` }
  ]);

  test("uses MOCK_AI_PORT, not the API's PORT, and binds loopback only", async () => {
    const reachable = await new Promise((resolve) => net.connect(3000, "127.0.0.1").on("connect", function () { this.destroy(); resolve(true); }).on("error", () => resolve(false)));
    assert.equal(reachable, false, "must not listen on the API port");
    assert.equal((await (await fetch(base + "/healthz")).json()).demo, true);
  });

  const cases = [
    ["ROYALTY_PAYMENTS", "I have not received my royalty payment in my bank", "Royalty & Payments", "kb.royalty-policy"],
    ["ISBN_METADATA", "The ISBN looks like a duplicate of another book", "ISBN & Metadata Issues", "kb.isbn-policy"],
    ["PRINTING_QUALITY", "My copy has a misprint and the binding is torn", "Printing & Quality", "kb.printing-quality"],
    ["DISTRIBUTION_AVAILABILITY", "My book is unavailable on Amazon and Flipkart", "Distribution & Availability", "kb.distribution-availability"],
    ["BOOK_STATUS_PRODUCTION", "What stage is typesetting and proofreading at, any delay", "Book Status & Production Updates", "kb.production-stages"],
    ["GENERAL_INQUIRY", "Hello, tell me about the company", "General Inquiry", "kb.company-overview"]
  ];
  for (const [category, text, label, chunk] of cases) {
    test(`${category}: classification and draft are labelled demo output`, async () => {
      const { content: c } = await classify(text, [chunk]);
      assert.equal(c.category, category);
      assert.match(c.rationale, /^\[DEMO MOCK/);
      assert.deepEqual(c.citations, [chunk]);
      const { content: d } = await draft(label, [chunk]);
      assert.match(d.draft, /\[DEMO DRAFT/);
      assert.match(d.draft, /\{\{authorFirstName\}\}/);
      assert.doesNotMatch(d.draft, /[₹$]|\brs\.?\s?\d|\binr\b/i, "no invented money");
      assert.deepEqual(d.citations, [chunk]);
    });
  }

  test("cites only knowledge-base chunks that were offered in the request", async () => {
    assert.deepEqual((await classify("royalty payment question", ["kb.isbn-policy"])).content.citations, []);
  });

  test("keys on the author text, not on policy excerpts elsewhere in the prompt", async () => {
    assert.equal((await classify("hello there", ["kb.royalty-policy"])).content.category, "GENERAL_INQUIRY");
  });

  test("reports zero cost and token usage; never echoes the prompt", async () => {
    const { body } = await classify("royalty payment SECRET-CANARY-123");
    assert.equal(body.usage.cost, 0);
    assert.doesNotMatch(JSON.stringify(body), /SECRET-CANARY-123/);
  });

  test("unknown routes are 404 and malformed bodies are 400", async () => {
    assert.equal((await fetch(base + "/nope")).status, 404);
    const bad = await fetch(`${base}/api/v1/chat/completions`, { method: "POST", body: "{not json" });
    assert.equal(bad.status, 400);
  });
});
