import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import * as contracts from "@bookleaf/contracts";
import { Prisma, TicketCategory, TicketPriority, TicketStatus, UserRole, MessageVisibility, AiAnalysisStatus } from "@bookleaf/db";

// Independently synthetic fixtures. Never load local seed data or reference documents.
const createdAt = "2026-01-01T00:00:00.000Z";
const profile = {
  id: "profile-demo", userId: "user-demo", externalAuthorId: "synthetic-author",
  name: "Synthetic Author", phone: "", city: "Demo City", joinedDate: "2026-01-01"
};
const ticket = {
  id: "ticket-demo", authorId: profile.id, bookId: null, subject: "Synthetic inquiry", description: "Synthetic description only",
  status: "OPEN", category: null, priority: null, assigneeId: null, createdAt, updatedAt: createdAt
};
const message = {
  id: "message-demo", ticketId: ticket.id, authorId: "user-demo", body: "Synthetic reply", visibility: "AUTHOR", createdAt
};
const result = {
  category: "GENERAL_INQUIRY", priority: "LOW", confidence: 0.5, rationale: "Synthetic rationale",
  draftResponse: "Synthetic draft", requiresHumanReview: true, knowledgeBaseCitations: ["synthetic-policy"]
};
const attempt = { id: "attempt-demo", ticketId: ticket.id, createdAt };

test("package imports work without database configuration or an exported client instance", () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    const contracts = await import('@bookleaf/contracts');
    const db = await import('@bookleaf/db');
    const ai = await import('@bookleaf/ai');
    if (typeof contracts.authResponseSchema.parse !== 'function') throw new Error('Missing contracts');
    if (typeof db.PrismaClient !== 'function') throw new Error('Missing Prisma constructor');
    if (Object.values(db).some(value => value instanceof db.PrismaClient)) throw new Error('Global client exported');
    if (typeof ai.AiUnavailableError !== 'function') throw new Error('Missing AI runtime entry');
    console.log('imports passed');
  `], { env, encoding: "utf8", timeout: 10000 });
  assert.match(output, /imports passed/);
});

test("contract enum values agree with generated Prisma enums", () => {
  for (const [wire, persisted] of [
    [contracts.ticketCategories, TicketCategory], [contracts.ticketPriorities, TicketPriority],
    [contracts.ticketStatuses, TicketStatus], [contracts.userRoles, UserRole],
    [contracts.messageVisibilities, MessageVisibility], [contracts.aiAnalysisStatuses, AiAnalysisStatus]
  ]) assert.deepEqual([...wire].sort(), Object.values(persisted).sort());
});

test("resource scalar names and nullable fields agree with the Prisma baseline", () => {
  for (const [modelName, schema] of [
    ["AuthorProfile", contracts.authorProfileSchema], ["Book", contracts.bookSchema],
    ["Ticket", contracts.ticketSchema], ["TicketMessage", contracts.ticketMessageSchema],
    ["InternalNote", contracts.internalNoteResourceSchema], ["TicketAssignment", contracts.ticketAssignmentSchema]
  ]) {
    const model = Prisma.dmmf.datamodel.models.find(value => value.name === modelName);
    const scalarFields = model.fields.filter(field => field.kind !== "object");
    assert.deepEqual(Object.keys(schema.shape).sort(), scalarFields.map(field => field.name).sort(), modelName);
    for (const field of scalarFields) {
      assert.equal(schema.shape[field.name].isNullable(), !field.isRequired, `${modelName}.${field.name}`);
      assert.equal(schema.shape[field.name].isOptional(), false, `${modelName}.${field.name} must be present`);
    }
  }
});

test("auth strips private user/session fields and accepts an explicit null profile", () => {
  const parsed = contracts.authResponseSchema.parse({ user: {
    id: "user-demo", email: "demo@example.invalid", role: "AUTHOR", authorProfile: profile,
    passwordHash: "synthetic-secret", sessions: [{ tokenHash: "synthetic-secret" }]
  } });
  assert.equal("passwordHash" in parsed.user, false);
  assert.equal("sessions" in parsed.user, false);
  assert.equal(contracts.meResponseSchema.safeParse({ user: { ...parsed.user, role: "ADMIN", authorProfile: null } }).success, true);
  assert.equal(contracts.meResponseSchema.safeParse({ user: { ...parsed.user, authorProfile: undefined } }).success, false);
});

test("books preserve nulls, zeros and empty availability; date-only fields are validated", () => {
  const book = {
    id: "book-demo", externalBookId: "synthetic-book", authorId: profile.id, title: "Synthetic Book", isbn: "synthetic-isbn",
    genre: "Demo", publicationDate: null, status: "In Production", mrp: null, authorRoyaltyPerCopy: null,
    totalCopiesSold: 0, totalRoyaltyEarned: 0, royaltyPaid: 0, royaltyPending: 0, lastRoyaltyPayoutDate: null,
    printPartner: null, availableOn: []
  };
  assert.deepEqual(contracts.bookSchema.parse(book), book);
  assert.equal(contracts.bookSchema.safeParse({ ...book, mrp: undefined }).success, false);
  assert.equal(contracts.bookSchema.safeParse({ ...book, publicationDate: "2026-02-30" }).success, false);
  assert.equal(contracts.bookSchema.safeParse({ ...book, publicationDate: createdAt }).success, false);
});

test("all list envelopes enforce consistent pagination without response coercion", () => {
  for (const schema of [contracts.bookListResponseSchema, contracts.ticketListResponseSchema, contracts.adminQueueResponseSchema]) {
    assert.deepEqual(schema.parse({ items: [], page: 1, pageSize: 25, total: 0 }), { items: [], page: 1, pageSize: 25, total: 0 });
    for (const invalid of [{ page: 0 }, { pageSize: 101 }, { total: -1 }, { page: "1" }, { total: undefined }]) {
      assert.equal(schema.safeParse({ items: [], page: 1, pageSize: 25, total: 0, ...invalid }).success, false);
    }
  }
  assert.equal(contracts.ticketListResponseSchema.parse({ items: [ticket], page: 1, pageSize: 25, total: 1 }).items[0].category, null);
});

test("author detail excludes admin data and rejects admin-only messages", () => {
  const detail = contracts.ticketDetailResponseSchema.parse({
    ticket, messages: [message], internalNotes: [{ body: "Synthetic private note" }], aiAnalysis: result
  });
  assert.equal("internalNotes" in detail, false);
  assert.equal("aiAnalysis" in detail, false);
  assert.equal(contracts.ticketDetailResponseSchema.safeParse({ ticket, messages: [{ ...message, visibility: "ADMIN" }] }).success, false);
  assert.equal(contracts.ticketMessageResponseSchema.safeParse({ message: { ...message, visibility: "ADMIN" } }).success, false);
  assert.equal(contracts.adminTicketDetailResponseSchema.safeParse({
    ticket, author: profile, book: null, messages: [{ ...message, visibility: "ADMIN" }],
    internalNotes: [], assignments: [], aiAnalysis: null, auditEvents: []
  }).success, true);
});

test("AI drafts always require review and HTTP attempts enforce state invariants", () => {
  assert.equal(contracts.aiAnalysisSchema.safeParse({ ...result, requiresHumanReview: false }).success, false);
  assert.equal(contracts.aiAnalysisSchema.safeParse({ ...result, confidence: 1.1 }).success, false);
  assert.equal(contracts.aiAnalysisSchema.safeParse({ ...result, knowledgeBaseCitations: [42] }).success, false);
  for (const state of [
    { status: "PENDING", analysis: null, errorCode: null },
    { status: "COMPLETED", analysis: result, errorCode: null },
    { status: "FAILED", analysis: null, errorCode: "AI_UNAVAILABLE" }
  ]) assert.equal(contracts.aiAnalysisAttemptSchema.safeParse({ ...attempt, ...state }).success, true);
  for (const state of [
    { status: "PENDING", analysis: result, errorCode: null },
    { status: "COMPLETED", analysis: null, errorCode: null },
    { status: "FAILED", analysis: null, errorCode: null },
    { status: "FAILED", analysis: result, errorCode: "AI_UNAVAILABLE" }
  ]) assert.equal(contracts.aiAnalysisAttemptSchema.safeParse({ ...attempt, ...state }).success, false);
  assert.equal(contracts.aiAnalysisResponseSchema.safeParse({ analysis: null }).success, true);
  assert.equal(contracts.aiAnalysisRequestResponseSchema.safeParse({ analysis: null }).success, false);
  const model = Prisma.dmmf.datamodel.models.find(value => value.name === "AiAnalysis");
  assert.equal(model.fields.some(field => field.name === "requiresHumanReview"), false);
  assert.equal(model.fields.find(field => field.name === "citations").type, "Json");
});

test("standard errors and safe audit projections have no raw exception/change fields", () => {
  const error = contracts.apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Invalid request", stack: "private" } });
  assert.deepEqual(error, { error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
  const audit = contracts.auditEventSchema.parse({
    id: "audit-demo", actorId: null, action: "ticket.updated", entityType: "Ticket", entityId: ticket.id,
    requestId: null, createdAt, before: { private: true }, after: { private: true }
  });
  assert.equal("before" in audit, false);
  assert.equal("after" in audit, false);
});
