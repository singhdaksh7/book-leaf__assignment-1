import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { aiAnalysisAttemptSchema, aiAnalysisSchema, bookSchema, type TicketAiAnalysis } from "@bookleaf/contracts";
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";
import type { AiService, AnalyzeTicketInput } from "../src/index.js";
import { classifyContent, draftContent, scriptedProvider, timeoutError } from "./helpers.js";

const root = join(__dirname, "..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith(".ts") ? [join(dir, n)] : []));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, Record<string, string> & { ".": Record<string, string> }>;

// Synthetic book that satisfies the shared Book DTO (no real records).
const book = bookSchema.parse({
  id: "b1", externalBookId: "ext-1", authorId: "a1", title: "Synthetic Title", isbn: "978-0-00-000000-2", genre: "Fiction", publicationDate: null,
  status: "Typesetting", mrp: null, authorRoyaltyPerCopy: null, totalCopiesSold: 0, totalRoyaltyEarned: 0, royaltyPaid: 0, royaltyPending: 0,
  lastRoyaltyPayoutDate: null, printPartner: null, availableOn: []
});

describe("shared contract compatibility (no contract changes required)", () => {
  it("AiService is implemented by the shipped service (compile-time check)", () => {
    const service: AiService = api.createAiService({ provider: scriptedProvider(new Error("x")) });
    const input: AnalyzeTicketInput = { ticketId: "t", subject: "s", description: "d", authorContext: {} };
    expect(typeof service.analyzeTicket(input).then).toBe("function");
  });
  it("analyzeTicket returns exactly the TicketAiAnalysis fields, for success and every fallback", async () => {
    const contractKeys = Object.keys(aiAnalysisSchema.shape).sort();
    const runs = [
      scriptedProvider(JSON.parse(classifyContent()), JSON.parse(draftContent("Our team will follow up."))),
      scriptedProvider(timeoutError()), scriptedProvider("junk", "junk"), scriptedProvider(JSON.parse(classifyContent()), "junk")
    ];
    for (const provider of runs) {
      const a: TicketAiAnalysis = await api.createAiService({ provider }).analyzeTicket({ ticketId: "t", subject: "Royalty", description: "royalty", authorContext: {} });
      expect(Object.keys(a).sort()).toEqual(contractKeys);
      expect(aiAnalysisSchema.strict().safeParse(a).success).toBe(true);
      expect(a.requiresHumanReview).toBe(true);
    }
  });
  it("accepts a Book DTO as bookContext and reads only a whitelist of its fields", async () => {
    const provider = scriptedProvider(JSON.parse(classifyContent()), JSON.parse(draftContent("Our team will follow up.")));
    await api.createAiService({ provider }).analyzeTicket({ ticketId: "t", subject: "Status", description: "when will it be done", authorContext: {}, bookContext: book });
    expect(provider.calls[0]!.user).toContain("Typesetting");
    expect(provider.calls[0]!.user).not.toMatch(/Synthetic Title|978-0|ext-1|"authorId"/);
    expect(provider.calls[1]!.user).toContain('"publicationDate":null'); // production books keep explicit nulls, never zero or empty string
    expect(provider.calls[1]!.user).toContain("null = unknown");
  });
  it("every attempt state the helpers emit parses with the shared aiAnalysisAttemptSchema", async () => {
    const base = { id: "a1", ticketId: "t1", createdAt: new Date("2026-01-01T00:00:00Z") };
    const rows = [
      api.pendingRow(), api.abandonedRow(),
      (await api.analyzeForPersistence(api.createAiService({ provider: scriptedProvider(timeoutError()) }), { ticketId: "t", subject: "s", description: "royalty", authorContext: {} })).row,
      (await api.analyzeForPersistence(api.createAiService({ provider: scriptedProvider(JSON.parse(classifyContent()), JSON.parse(draftContent("Our team will follow up."))) }), { ticketId: "t", subject: "s", description: "royalty", authorContext: {} })).row
    ];
    expect(rows.map((r) => r.status)).toEqual(["PENDING", "FAILED", "FAILED", "COMPLETED"]);
    for (const row of rows) expect(aiAnalysisAttemptSchema.safeParse(api.serializeAttempt({ ...base, ...row })).success).toBe(true);
  });
  it("citations round-trip: row citations ⇄ knowledgeBaseCitations", async () => {
    const r = await api.analyzeForPersistence(api.createAiService({ provider: scriptedProvider(JSON.parse(classifyContent()), JSON.parse(draftContent("Our team will follow up."))) }), { ticketId: "t", subject: "s", description: "royalty", authorContext: {} });
    const wire = api.serializeAttempt({ id: "a", ticketId: "t", createdAt: new Date(), ...r.row });
    expect(wire.status === "COMPLETED" && wire.analysis.knowledgeBaseCitations).toEqual(r.row.citations);
  });
  it("exposes the integration surface the backend needs and nothing that sends", () => {
    for (const name of ["createAiServiceFromEnv", "createAiService", "analyzeForPersistence", "pendingRow", "decideAttempt", "serializeAttempt", "inputFingerprint", "worstCaseAnalysisMs", "isPendingAttemptAbandoned", "abandonedRow", "retryAdviceFor", "PROMPT_VERSION", "AiUnavailableError", "UsageTracker", "loadAiConfig"]) {
      expect(api, name).toHaveProperty(name);
    }
    expect(Object.keys(api).filter((k) => /send|notify|mail|post|publish/i.test(k))).toEqual([]);
  });
});

describe("package quality (clean-install readiness)", () => {
  it("source imports only declared dependencies, Node built-ins and relative files", () => {
    const declared = new Set(Object.keys(pkg.dependencies ?? {}));
    for (const f of files(join(root, "src"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const spec = m[1]!;
        if (spec.startsWith(".") || spec.startsWith("node:")) continue;
        expect(declared.has(spec) || declared.has(spec.split("/").slice(0, 2).join("/")), `${f}: ${spec}`).toBe(true);
      }
    }
  });
  it("tests import only declared dependencies, dev dependencies or Node built-ins", () => {
    const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    for (const f of files(join(root, "tests"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) {
        const spec = m[1]!;
        if (spec.startsWith(".") || spec.startsWith("node:")) continue;
        expect(declared.has(spec) || declared.has(spec.split("/")[0]!), `${f}: ${spec}`).toBe(true);
      }
    }
  });
  it("declares runtime and test dependencies, and exports only the built entry point", () => {
    expect(pkg.dependencies).toMatchObject({ "@bookleaf/contracts": expect.any(String), zod: expect.any(String) });
    expect(pkg.devDependencies).toMatchObject({ vitest: expect.any(String), "@types/node": expect.any(String) });
    expect(pkg.exports!["."]).toEqual({ types: "./dist/index.d.ts", import: "./dist/index.js" });
    expect(pkg.scripts).toMatchObject({ build: expect.any(String), typecheck: expect.any(String), test: expect.any(String) });
  });
  it("uses relative imports with explicit .js extensions (NodeNext/ESM)", () => {
    for (const f of files(join(root, "src"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/from\s+["'](\.[^"']+)["']/g)) expect(m[1], f).toMatch(/\.js$/);
    }
  });
  it("ships no environment files with values", () => {
    const example = readFileSync(join(root, ".env.example"), "utf8");
    expect(example).toMatch(/^OPENROUTER_API_KEY=$/m);
    expect(example).not.toMatch(/sk-or-/);
  });
});
