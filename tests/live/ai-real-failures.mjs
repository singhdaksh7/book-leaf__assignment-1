// Representative REAL provider failures, using the owner's key from infra/.env (never printed). Checks that each failure is recorded with the
// right code, is not silently replaced by mock output, and never reaches a paid model. Uses a bogus key and a nonexistent model, so it
// consumes almost no free quota. Optional: set CHECK_DEFAULT_ALT=1 to also re-test an alternative free model (about 2-6 requests).
//
//   npm run build && node tests/live/ai-real-failures.mjs        exit 0 = all expectations met, 1 = a failure, 2 = blocked (no key)
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const envFile = resolve(root, "infra", ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*((?:OPENROUTER|AI)_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const realKey = process.env.OPENROUTER_API_KEY;
if (!realKey || realKey.length < 8) { console.log("BLOCKED: OPENROUTER_API_KEY is not set (infra/.env)."); process.exit(2); }

const ai = await import("../../packages/ai/dist/index.js");
const input = { ticketId: "synthetic-failure", subject: "No royalty yet", description: "I published my book four months ago and have not received any royalty.", authorContext: { name: "Synthetic Author" } };
const base = { OPENROUTER_API_KEY: realKey, OPENROUTER_MODEL: "nvidia/nemotron-3-super-120b-a12b:free", AI_MAX_RETRIES: "1", AI_RETRY_BASE_DELAY_MS: "300" };
let bad = 0;

async function scenario(name, env, expectReasons, { expectNoRequest = false } = {}) {
  let requests = 0;
  const countingFetch = async (...a) => { requests += 1; return fetch(...a); };
  const svc = ai.createAiServiceFromEnv({ ...base, ...env }, { fetch: countingFetch });
  const t = Date.now();
  const out = await svc.analyzeTicketDetailed(input);
  const reasons = [...new Set(out.meta.fallbackReasons)];
  const noModelOutput = out.meta.classificationSource !== "model" && out.meta.draftSource !== "model";
  const ok = expectReasons.every((r) => reasons.includes(r)) && noModelOutput && (!expectNoRequest || requests === 0);
  if (!ok) bad += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: reasons=[${reasons.join(",")}] httpRequests=${requests} modelOutputUsed=${!noModelOutput} ${Date.now() - t}ms`);
  return out;
}

// 1. Rejected credentials (real 401): AI_NOT_CONFIGURED, not retried.
await scenario("rejected key (401)", { OPENROUTER_API_KEY: "sk-or-v1-" + "0".repeat(48) }, ["AI_NOT_CONFIGURED"]);
// 2. Nonexistent free model (real 4xx): a clear provider error, bounded, no substitution.
await scenario("nonexistent free model", { OPENROUTER_MODEL: "nvidia/does-not-exist-" + Date.now() + ":free" }, ["AI_PROVIDER_ERROR"]);
// 3. Paid model: rejected by configuration before any network call.
await scenario("paid primary model", { OPENROUTER_MODEL: "openai/gpt-4o-mini" }, ["AI_NOT_CONFIGURED"], { expectNoRequest: true });
// 4. Paid fallback model: also rejected before any network call.
await scenario("paid fallback model", { OPENROUTER_FALLBACK_MODEL: "anthropic/claude-sonnet-4" }, ["AI_NOT_CONFIGURED"], { expectNoRequest: true });
// 5. Optional: an alternative free model whose upstream may be rate limited (reports the current state; neither outcome is a failure).
if (process.env.CHECK_DEFAULT_ALT === "1") {
  const out = await scenario("alternative free model (informational)", { OPENROUTER_MODEL: "google/gemma-4-31b-it:free" }, []);
  console.log(`INFO alternative model state: classification=${out.meta.classificationSource} draft=${out.meta.draftSource} reasons=[${[...new Set(out.meta.fallbackReasons)].join(",")}]`);
}
console.log(`\nPROVIDER FAILURE TESTS ${bad === 0 ? "PASSED" : "FAILED"} (${bad} failing)`);
process.exit(bad === 0 ? 0 : 1);
