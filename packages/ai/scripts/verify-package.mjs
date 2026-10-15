// Verifies the BUILT package (dist/) the way the backend will consume it. Offline: any network attempt fails the check.
import assert from "node:assert/strict";

globalThis.fetch = () => { throw new Error("network access is not allowed in verify-package"); };

const ai = await import("../dist/index.js");
const required = [
  "createAiServiceFromEnv", "createAiService", "BookLeafAiService", "createOpenRouterProvider", "createTicketClassifier", "createResponseDrafter",
  "createKnowledgeRetriever", "analyzeForPersistence", "decideAttempt", "serializeAttempt", "pendingRow", "abandonedRow", "inputFingerprint",
  "worstCaseAnalysisMs", "isPendingAttemptAbandoned", "retryAdviceFor", "findUnsupportedClaims", "redactPii", "loadAiConfig", "UsageTracker",
  "AiUnavailableError", "PROMPT_VERSION", "KB_VERSION", "KB_CHUNKS"
];
for (const name of required) assert.notEqual(ai[name], undefined, `missing export: ${name}`);
assert.equal(Object.keys(ai).filter((k) => /send|notify|mail/i.test(k)).length, 0, "package must not export anything that sends");

// No key configured: must degrade, never throw, never touch the network.
const service = ai.createAiServiceFromEnv({});
const r = await ai.analyzeForPersistence(service, { ticketId: "t", subject: "Wrong ISBN", description: "My book has a duplicate ISBN on Amazon", authorContext: { name: "Sam" } });
assert.equal(r.status, "FAILED");
assert.equal(r.errorCode, "AI_NOT_CONFIGURED");
assert.equal(r.retry, "after-config");
assert.equal(r.fallbackAnalysis.requiresHumanReview, true);
assert.equal(r.fallbackAnalysis.category, "ISBN_METADATA");
assert.equal(r.fallbackAnalysis.priority, "HIGH");

// Secrets stay redacted even if the config object is serialised.
const config = ai.loadAiConfig({ OPENROUTER_API_KEY: "sk-or-verify-0000000000" });
assert.ok(!JSON.stringify(config).includes("sk-or-verify"));
console.log(`verify-package OK (${Object.keys(ai).length} exports, KB ${ai.KB_VERSION})`);
