import { aiAnalysisSchema } from "@bookleaf/contracts";
import { Prisma, type AiAnalysis, type PrismaClient } from "@bookleaf/db";
import type { Logger } from "../http/logger.js";
import { silentLogger } from "../http/logger.js";
import type { TicketEventHub } from "../events/hub.js";
import { serializeBook } from "../serializers.js";
import { retryableErrorCodes, type AiAnalysisInput, type AiEngine, type AiRowData } from "./engine.js";

type Tx = Prisma.TransactionClient;

export interface AiAttemptOptions {
  prisma: PrismaClient;
  engine: AiEngine;
  events?: TicketEventHub;
  logger?: Logger;
  /** An admin refresh within this window of the latest attempt returns that attempt instead of paying for another. */
  refreshCooldownMs?: number;
  /** Automatic retries of transient failures per ticket (package guidance: at most two). */
  maxAutoRetries?: number;
  /** Minimum gap between a failed attempt and its automatic retry (package guidance: at least a minute). */
  retryMinGapMs?: number;
  /** Concurrent provider calls from this process. */
  maxConcurrent?: number;
  /** Recovery sweep period. */
  recoveryIntervalMs?: number;
  now?: () => Date;
}

const errorCodePattern = /^[A-Z][A-Z0-9_]{2,59}$/;

/** Database-NULL-safe write payload; `citations: null` must be Prisma.DbNull, not JSON null. */
function rowToData(row: AiRowData) {
  return { ...row, citations: row.citations ?? Prisma.DbNull };
}

/** A PENDING row built from known-good fields only, so a faulty engine can never violate the table's state invariants. */
const pendingData = (engine: AiEngine) => rowToData({
  status: "PENDING", promptVersion: engine.pendingRow().promptVersion || "unknown", model: null, category: null, priority: null, confidence: null,
  rationale: null, draftResponse: null, citations: null, inputTokens: null, outputTokens: null, costMicrounits: null, errorCode: null
});
const abandonedData = (engine: AiEngine) => rowToData(sanitiseRow({ ...engine.abandonedRow(), status: "FAILED", errorCode: "AI_ATTEMPT_ABANDONED" }, "unknown"));

/**
 * Normalises a row produced by the engine before it is stored. A COMPLETED row that does not satisfy the shared
 * contract is converted to FAILED so a partial or invalid draft is never persisted or shown. Error codes are reduced to a
 * safe identifier; cost stays null when unknown.
 */
export function sanitiseRow(row: AiRowData, fallbackPromptVersion: string): AiRowData {
  const promptVersion = row.promptVersion || fallbackPromptVersion;
  const usage = {
    model: typeof row.model === "string" ? row.model.slice(0, 120) : null,
    inputTokens: Number.isInteger(row.inputTokens) && (row.inputTokens as number) >= 0 ? row.inputTokens : null,
    outputTokens: Number.isInteger(row.outputTokens) && (row.outputTokens as number) >= 0 ? row.outputTokens : null,
    costMicrounits: Number.isInteger(row.costMicrounits) && (row.costMicrounits as number) >= 0 ? row.costMicrounits : null
  };
  const failed = (code: string): AiRowData => ({
    status: "FAILED", promptVersion, ...usage, category: null, priority: null, confidence: null, rationale: null, draftResponse: null, citations: null,
    errorCode: errorCodePattern.test(code) ? code : "AI_PROVIDER_ERROR"
  });
  if (row.status === "FAILED") return failed(row.errorCode ?? "");
  if (row.status !== "COMPLETED") return failed("AI_INTERNAL_ERROR");
  const parsed = aiAnalysisSchema.safeParse({
    category: row.category, priority: row.priority, confidence: row.confidence, rationale: row.rationale,
    draftResponse: row.draftResponse, requiresHumanReview: true, knowledgeBaseCitations: row.citations
  });
  if (!parsed.success) return failed("AI_RESULT_INVALID");
  return {
    status: "COMPLETED", promptVersion, ...usage, category: parsed.data.category, priority: parsed.data.priority, confidence: parsed.data.confidence,
    rationale: parsed.data.rationale, draftResponse: parsed.data.draftResponse, citations: parsed.data.knowledgeBaseCitations, errorCode: null
  };
}

/**
 * Persists and drives AI analysis attempts. It never classifies or drafts (the engine does), never creates a ticket
 * message and never changes ticket status: a draft is only data for an admin to review.
 */
export class AiAttemptService {
  private readonly prisma: PrismaClient;
  private readonly engine: AiEngine;
  private readonly events?: TicketEventHub;
  private readonly logger: Logger;
  private readonly refreshCooldownMs: number;
  private readonly maxAutoRetries: number;
  private readonly retryMinGapMs: number;
  private readonly maxConcurrent: number;
  private readonly recoveryIntervalMs: number;
  private readonly now: () => Date;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly queue: Array<() => void> = [];
  private running = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(options: AiAttemptOptions) {
    this.prisma = options.prisma;
    this.engine = options.engine;
    this.events = options.events;
    this.logger = options.logger ?? silentLogger;
    this.refreshCooldownMs = options.refreshCooldownMs ?? 30_000;
    this.maxAutoRetries = options.maxAutoRetries ?? 2;
    this.retryMinGapMs = options.retryMinGapMs ?? 60_000;
    this.maxConcurrent = options.maxConcurrent ?? 2;
    this.recoveryIntervalMs = options.recoveryIntervalMs ?? 60_000;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Ensures an attempt exists for the ticket. The caller must hold the ticket row lock (`SELECT ... FOR UPDATE`) inside `tx`,
   * which serialises concurrent callers across processes; the partial unique index is the backstop.
   *
   * - latest PENDING and still within its window  -> returned unchanged (single-flight, idempotent retry)
   * - latest PENDING but abandoned                -> closed as FAILED/AI_ATTEMPT_ABANDONED, then a new attempt is created
   * - latest terminal and younger than `cooldownMs` -> returned unchanged (double-click / retried request)
   * - otherwise                                   -> a new PENDING row is written before any provider call
   */
  async enqueue(tx: Tx, ticketId: string, cooldownMs = 0): Promise<{ attempt: AiAnalysis; created: boolean }> {
    const latest = await tx.aiAnalysis.findFirst({ where: { ticketId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const now = this.now();
    if (latest?.status === "PENDING") {
      if (now.getTime() - latest.createdAt.getTime() <= this.engine.abandonAfterMs) return { attempt: latest, created: false };
      await tx.aiAnalysis.updateMany({ where: { id: latest.id, status: "PENDING" }, data: abandonedData(this.engine) });
    } else if (latest && cooldownMs > 0 && now.getTime() - latest.createdAt.getTime() < cooldownMs) {
      return { attempt: latest, created: false };
    }
    const attempt = await tx.aiAnalysis.create({ data: { ticketId, ...pendingData(this.engine) } });
    return { attempt, created: true };
  }

  /**
   * Admin-triggered (re)analysis. Locks the ticket, so repeated or concurrent requests collapse into one attempt. When a new
   * attempt is created, the audit row is written in the same transaction.
   */
  async requestRefresh(ticketId: string, audit?: { actorId: string; requestId?: string }): Promise<{ attempt: AiAnalysis; created: boolean; ticketStatus: string } | null> {
    const execute = () => this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT "id", "status" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`;
      const ticket = locked[0];
      if (!ticket) return null;
      if (ticket.status === "CLOSED") return { attempt: null as unknown as AiAnalysis, created: false, ticketStatus: ticket.status };
      const result = await this.enqueue(tx, ticketId, this.refreshCooldownMs);
      if (result.created && audit) {
        await tx.auditLog.create({
          data: { actorId: audit.actorId, action: "ticket.ai_analysis.requested", entityType: "Ticket", entityId: ticketId, after: { attemptId: result.attempt.id }, requestId: audit.requestId }
        });
      }
      return { ...result, ticketStatus: ticket.status };
    });
    try {
      return await execute();
    } catch (error) {
      // The unique index fired because another process created the PENDING row first: join it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return execute();
      throw error;
    }
  }

  /** Starts processing in the background after the creating transaction has committed. Never throws. */
  kick(attemptId: string): void {
    const task = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.withSlot(() => this.runAttempt(attemptId)))
      .catch((error: unknown) => this.logger.log("error", "ai run crashed", { attemptId, errorName: error instanceof Error ? error.name : "unknown" }))
      .finally(() => this.inFlight.delete(task));
    this.inFlight.add(task);
  }

  /** Resolves when every background run started so far has finished (used by shutdown and tests). */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrent) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.running += 1;
    try {
      return await fn();
    } finally {
      this.running -= 1;
      this.queue.shift()?.();
    }
  }

  private async buildInput(ticketId: string): Promise<AiAnalysisInput | null> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId }, include: { author: true, book: true } });
    if (!ticket) return null;
    // Conversation context is limited to author-visible messages: internal notes never reach the model.
    const messages = await this.prisma.ticketMessage.findMany({
      where: { ticketId, visibility: "AUTHOR" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 2, include: { author: { select: { role: true } } }
    });
    return {
      ticketId: ticket.id, subject: ticket.subject, description: ticket.description,
      authorContext: { name: ticket.author.name },
      ...(ticket.book ? { bookContext: serializeBook(ticket.book) as unknown as Record<string, unknown> } : {}),
      history: messages.reverse().map((m) => ({ author: m.author.role === "ADMIN" ? ("ADMIN" as const) : ("AUTHOR" as const), body: m.body }))
    };
  }

  /** Runs one PENDING attempt to a terminal state. Safe to call twice: the conditional update lets only one result win. */
  async runAttempt(attemptId: string): Promise<void> {
    const attempt = await this.prisma.aiAnalysis.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.status !== "PENDING") return;
    const fallbackVersion = attempt.promptVersion;

    let row: AiRowData;
    let quality = "FULL_FALLBACK";
    try {
      const input = await this.buildInput(attempt.ticketId);
      if (!input) return;
      const result = await this.engine.run(input);
      row = sanitiseRow(result.row, fallbackVersion);
      quality = result.quality;
    } catch {
      row = sanitiseRow({ ...this.engine.abandonedRow(), errorCode: "AI_INTERNAL_ERROR" }, fallbackVersion);
    }

    // State and result are written together, and only if the attempt is still PENDING (it may have been closed as abandoned).
    let written = 0;
    try {
      written = (await this.prisma.aiAnalysis.updateMany({ where: { id: attemptId, status: "PENDING" }, data: rowToData(row) })).count;
    } catch (error) {
      // A database invariant rejected the row; record a safe failure instead of leaving the attempt PENDING.
      this.logger.log("error", "ai result rejected by database", { attemptId, errorName: error instanceof Error ? error.name : "unknown" });
      row = sanitiseRow({ ...row, status: "FAILED", errorCode: "AI_RESULT_INVALID" }, fallbackVersion);
      written = (await this.prisma.aiAnalysis.updateMany({ where: { id: attemptId, status: "PENDING" }, data: rowToData(row) })).count;
    }
    if (written === 0) return;
    this.logger.log("info", "ai attempt finished", { attemptId, status: row.status, quality, errorCode: row.errorCode, costKnown: row.costMicrounits !== null });
    await this.announce(attempt.ticketId);
  }

  /** Admin-only event: authors never learn about AI activity. */
  private async announce(ticketId: string): Promise<void> {
    if (!this.events) return;
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId }, select: { authorId: true } });
    if (!ticket) return;
    const occurredAt = this.now();
    this.events.publish({ name: "ticket.analysis.updated", ticketId, authorProfileId: ticket.authorId, audience: "admin", occurredAt, version: occurredAt.toISOString() });
  }

  /**
   * Recovery sweep (safe to run in every process): closes abandoned PENDING attempts and retries transient failures a
   * bounded number of times, at least `retryMinGapMs` apart. Each step re-checks state under the ticket lock, so overlapping
   * sweeps and concurrent admin refreshes cannot create duplicates.
   */
  async recover(): Promise<{ abandoned: number; retried: number }> {
    const now = this.now();
    const staleBefore = new Date(now.getTime() - this.engine.abandonAfterMs);
    const stale = await this.prisma.aiAnalysis.findMany({ where: { status: "PENDING", createdAt: { lt: staleBefore } }, take: 100 });
    let abandoned = 0;
    for (const attempt of stale) {
      const { count } = await this.prisma.aiAnalysis.updateMany({ where: { id: attempt.id, status: "PENDING" }, data: abandonedData(this.engine) });
      abandoned += count;
      if (count > 0) await this.announce(attempt.ticketId);
    }

    const cutoff = new Date(now.getTime() - this.retryMinGapMs);
    const candidates = await this.prisma.aiAnalysis.findMany({
      where: { status: "FAILED", errorCode: { in: [...retryableErrorCodes] }, createdAt: { lte: cutoff } }, orderBy: { createdAt: "asc" }, take: 50
    });
    let retried = 0;
    for (const failed of candidates) {
      const created = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT "id", "status" FROM "Ticket" WHERE "id" = ${failed.ticketId} FOR UPDATE`;
        if (locked.length === 0 || locked[0]?.status === "CLOSED") return null;
        const latest = await tx.aiAnalysis.findFirst({ where: { ticketId: failed.ticketId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        if (latest?.id !== failed.id) return null; // someone already moved on (admin refresh, other sweep)
        const failures = await tx.aiAnalysis.count({ where: { ticketId: failed.ticketId, status: "FAILED", errorCode: { in: [...retryableErrorCodes] } } });
        if (failures > this.maxAutoRetries) return null; // initial attempt + maxAutoRetries retries is the ceiling
        return (await this.enqueue(tx, failed.ticketId)).attempt;
      }).catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
        throw error;
      });
      if (created) {
        retried += 1;
        this.kick(created.id);
      }
    }
    return { abandoned, retried };
  }

  /** Begins periodic recovery. The timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.recover().catch((error: unknown) => this.logger.log("error", "ai recovery failed", { errorName: error instanceof Error ? error.name : "unknown" }));
    }, this.recoveryIntervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.idle();
  }
}
