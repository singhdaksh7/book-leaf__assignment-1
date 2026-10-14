import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import type { AiAnalysisInput, AiEngine, AiRowData, AiRunResult } from "../src/ai/engine.js";
import { createLogger } from "../src/http/logger.js";

export const completedRow = (overrides: Partial<AiRowData> = {}): AiRowData => ({
  status: "COMPLETED", model: "test/model-a", promptVersion: "test-v1", category: "ROYALTY_PAYMENTS", priority: "HIGH", confidence: 0.82,
  rationale: "Author asks about a late payout.", draftResponse: "Hello, thank you for reaching out. Our team will review and follow up.",
  citations: ["kb.royalty-policy"], inputTokens: 420, outputTokens: 96, costMicrounits: 1234, errorCode: null, ...overrides
});

export const failedRow = (errorCode: string, overrides: Partial<AiRowData> = {}): AiRowData => ({
  status: "FAILED", model: null, promptVersion: "test-v1", category: null, priority: null, confidence: null, rationale: null, draftResponse: null,
  citations: null, inputTokens: null, outputTokens: null, costMicrounits: null, errorCode, ...overrides
});

export interface FakeEngine extends AiEngine {
  calls: AiAnalysisInput[];
  /** Replace the behaviour of the next runs. */
  behave(fn: (input: AiAnalysisInput) => Promise<AiRunResult>): void;
}

export function fakeEngine(initial: (input: AiAnalysisInput) => Promise<AiRunResult> = async () => ({ row: completedRow(), quality: "MODEL" }), abandonAfterMs = 60_000): FakeEngine {
  let behaviour = initial;
  const engine: FakeEngine = {
    calls: [],
    abandonAfterMs,
    pendingRow: () => failedRow("x", { status: "PENDING", errorCode: null }),
    abandonedRow: () => failedRow("AI_ATTEMPT_ABANDONED"),
    behave(fn) { behaviour = fn; },
    async run(input) {
      engine.calls.push(structuredClone(input));
      return behaviour(input);
    }
  };
  return engine;
}

export function gate<T = void>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { release = resolve; });
  return { promise, release };
}

export function captureLogger() {
  const lines: Array<Record<string, unknown>> = [];
  return { lines, logger: createLogger((line) => lines.push(JSON.parse(line) as Record<string, unknown>)), text: () => JSON.stringify(lines) };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface SseEvent { id: string; event: string; data: Record<string, unknown> }

export interface SseClient {
  status: number;
  headers: http.IncomingHttpHeaders;
  events: SseEvent[];
  raw: () => string;
  ended: () => boolean;
  /** Resolves when `predicate` is satisfied or rejects after the timeout. */
  waitFor(predicate: (events: SseEvent[]) => boolean, timeoutMs?: number): Promise<SseEvent[]>;
  /** Asserts nothing arrives for `ms`. */
  quiet(ms: number): Promise<SseEvent[]>;
  close(): void;
}

export function startServer(app: Express): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); })
      });
    });
  });
}

/** Minimal SSE client over node:http so tests exercise the real HTTP stream. */
export function openStream(port: number, cookie: string | null, headers: Record<string, string> = {}): Promise<SseClient> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: (headers["x-path"] ?? "/api/v1/events/tickets"), method: "GET", headers: { Accept: "text/event-stream", ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
      let buffer = "";
      let raw = "";
      let finished = false;
      const events: SseEvent[] = [];
      const listeners = new Set<() => void>();
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        raw += chunk;
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const fields: Record<string, string> = {};
          for (const line of block.split("\n")) {
            const colon = line.indexOf(":");
            if (colon > 0) fields[line.slice(0, colon)] = line.slice(colon + 1).trim();
          }
          if (fields.event) events.push({ id: fields.id ?? "", event: fields.event, data: JSON.parse(fields.data ?? "{}") as Record<string, unknown> });
        }
        listeners.forEach((l) => l());
      });
      res.on("end", () => { finished = true; listeners.forEach((l) => l()); });
      res.on("close", () => { finished = true; listeners.forEach((l) => l()); });
      const client: SseClient = {
        status: res.statusCode ?? 0, headers: res.headers, events, raw: () => raw, ended: () => finished,
        waitFor: (predicate, timeoutMs = 4000) => new Promise((ok, fail) => {
          const check = () => { if (predicate(events) || finished) { clearTimeout(timer); listeners.delete(check); predicate(events) ? ok([...events]) : fail(new Error("stream ended before condition")); } };
          const timer = setTimeout(() => { listeners.delete(check); fail(new Error(`timeout waiting for events; got ${JSON.stringify(events.map((e) => e.event))}`)); }, timeoutMs);
          listeners.add(check);
          check();
        }),
        quiet: async (ms) => { const before = events.length; await sleep(ms); return events.slice(before); },
        close: () => req.destroy()
      };
      resolve(client);
    });
    req.on("error", reject);
    req.end();
  });
}
