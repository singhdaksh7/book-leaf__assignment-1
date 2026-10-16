// REAL OpenRouter acceptance run (free model, synthetic tickets only). Needs OPENROUTER_API_KEY, supplied via infra/.env or the
// process environment. Never prints the key, prompts or full responses: only metadata and pass/fail checks.
//
//   npm run build            # the script imports the built @bookleaf/ai package
//   node tests/live/ai-real.mjs            # six categories (12 model calls at most, plus bounded retries)
//   ANALYSES=1 node tests/live/ai-real.mjs # smoke test: first category only
//
// Free tier without purchased credits is 20 requests/minute and 50/day, so the script spaces requests out and stops on the
// first rate-limit. It exits non-zero on any failure; a skipped run (no key) exits 2 and must be reported as BLOCKED, not passed.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Load only OPENROUTER_* / AI_* variables from infra/.env (the file Compose reads); real env vars win.
const envFile = resolve(root, "infra", ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*((?:OPENROUTER|AI)_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY.length < 8) {
  console.log("BLOCKED: OPENROUTER_API_KEY is not set (put it in infra/.env). No request was made.");
  process.exit(2);
}
if (/^http:\/\/(127\.0\.0\.1|localhost)/.test(process.env.OPENROUTER_BASE_URL ?? "")) {
  console.log("BLOCKED: OPENROUTER_BASE_URL points at a local mock; this script only verifies the real provider.");
  process.exit(2);
}

const ai = await import("../../packages/ai/dist/index.js");
const config = ai.loadAiConfig(process.env); // throws unless the model is ":free"
const base = config.baseUrl;

// 1. Independently verify zero pricing from OpenRouter's catalog before spending any request.
for (const id of [config.model, config.fallbackModel].filter(Boolean)) {
  const r = await fetch(`${base}/models/${id}/endpoints`);
  if (!r.ok) { console.log(`FAIL pricing lookup ${id}: HTTP ${r.status}`); process.exit(1); }
  const eps = (await r.json()).data.endpoints;
  const paid = eps.filter((e) => Object.values(e.pricing ?? {}).some((v) => Number(v) !== 0 && Number.isFinite(Number(v))));
  if (eps.length === 0 || paid.length > 0) { console.log(`FAIL ${id} is not verified zero-cost (endpoints=${eps.length}, non-zero=${paid.length})`); process.exit(1); }
  console.log(`OK   pricing ${id}: ${eps.length} endpoint(s), all prices 0`);
}

const SCENARIOS = [
  ["ROYALTY_PAYMENTS", "No royalty yet", "I published my book four months ago and still have not received any royalty payment in my bank account. Can you check?"],
  ["ISBN_METADATA", "Different ISBN on Amazon", "The ISBN shown on Amazon is different from the ISBN printed on my physical copy. Please fix the metadata."],
  ["PRINTING_QUALITY", "Pages are faded", "My printed copies arrived with faded ink and several pages that are misaligned. I need this corrected."],
  ["DISTRIBUTION_AVAILABILITY", "Not on Flipkart", "My book is not available on Flipkart or any other online store even though it was marked as published."],
  ["BOOK_STATUS_PRODUCTION", "Status of my book", "What is the current production status of my book and when will the cover design stage be complete?"],
  ["GENERAL_INQUIRY", "Question about the portal", "Hello, how do I update my author biography and profile photo shown on the portal?"]
];
const limit = Number(process.env.ANALYSES ?? SCENARIOS.length);
const results = [];
const tracker = new ai.UsageTracker();
const service = ai.createAiServiceFromEnv(process.env, { usageTracker: tracker });

let failed = false;
for (const [expected, subject, description] of SCENARIOS.slice(0, limit)) {
  const started = Date.now();
  try {
    const out = await service.analyzeTicketDetailed({ ticketId: `synthetic-${expected}`, subject, description, authorContext: { name: "Synthetic Author" } });
    const a = out.analysis, m = out.meta;
    const checks = {
      realModelClassification: m.classificationSource === "model",
      realModelDraft: m.draftSource === "model",
      categoryMatches: a.category === expected,
      humanReviewRequired: a.requiresHumanReview === true,
      noInventedMoney: !/(?:₹|Rs\.?|INR|\$|USD)\s?\d/i.test(a.draftResponse ?? "")
    };
    const ok = Object.values(checks).every(Boolean);
    failed ||= !ok;
    results.push({ expected, ok, got: a.category, priority: a.priority, confidence: a.confidence, latencyMs: Date.now() - started, tokens: m.totalTokens, fallbackReasons: m.fallbackReasons, checks });
    console.log(`${ok ? "OK  " : "FAIL"} ${expected} -> ${a.category}/${a.priority} conf=${a.confidence} cls=${m.classificationSource} draft=${m.draftSource} tokens=${m.totalTokens} ${Date.now() - started}ms${ok ? "" : " " + JSON.stringify(checks)}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${expected}: ${e?.code ?? "ERROR"} (${e?.message ?? "unknown"})`);
    if (e?.code === "AI_RATE_LIMITED") { console.log("Stopping: rate limited."); break; }
  }
  await new Promise((r) => setTimeout(r, 4000)); // stay far below 20 requests/minute
}
const model = config.model;
console.log(`\nREAL OPENROUTER TEST ${failed ? "FAILED" : "PASSED"} model=${model} analyses=${results.length}/${limit} ok=${results.filter((r) => r.ok).length}`);
console.log(JSON.stringify({ model, provider: "openrouter", usage: tracker.summary?.() }, null, 0));
process.exit(failed ? 1 : 0);
