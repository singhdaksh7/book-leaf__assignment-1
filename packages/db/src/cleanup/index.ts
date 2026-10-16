/**
 * Synthetic-data cleanup: a read-only planner and a guarded executor.
 *
 * Safety model
 *  - A user is deletable only if its email is on the explicit whitelist AND it is an AUTHOR AND its profile/books carry the
 *    synthetic external ids. Anything else is reported as `excluded` and left alone. ADMIN users are never candidates.
 *  - Everything reachable from a deletable identity (tickets and their messages, notes, assignments, AI attempts and
 *    attachments) is counted exactly. The audit log is NEVER deleted or rewritten: the database makes it append-only
 *    (trigger AuditLog_append_only) and it is the release evidence. Its only change is the schema's own ON DELETE SET NULL
 *    on actorId, which that trigger explicitly permits. Any row that would be deleted but does not
 *    belong to a deletable identity or the admin is a `blocker`: the plan then refuses to execute.
 *  - Execution re-plans inside a Serializable transaction, requires the preview's confirmation token, deletes in
 *    dependency order, verifies every table count and the untouched admin set before commit, and rolls back otherwise.
 *  - Attachment files are removed only after the commit, by key, and a missing file is not an error.
 *  - Nothing here prints or returns message bodies, descriptions, AI text or attachment contents.
 */
import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { SYNTHETIC_AUTHOR_EMAILS, SYNTHETIC_AUTHOR_ID, SYNTHETIC_BOOK_ID } from "../synthetic.js";

type Db = PrismaClient | Prisma.TransactionClient;

export const TABLES = [
  "users", "authorProfiles", "books", "sessions", "tickets", "ticketMessages", "internalNotes", "ticketAssignments", "aiAnalyses", "ticketAttachments", "auditLogs"
] as const;
export type TableName = (typeof TABLES)[number];
export type Counts = Record<TableName, number>;

const MAX_IDS = 20_000;
const storageKeyPattern = /^[a-f0-9]{48}$/;
const backupStampPattern = /^\d{8}T\d{6}Z$/;

export class CleanupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleanupError";
  }
}

export interface ExcludedIdentity {
  userId: string;
  reason: string;
}

export interface CleanupPlan {
  /** Rows that exist today in each table (whole database). */
  totals: Counts;
  /** Rows the cleanup would remove (cascades included). */
  toDelete: Counts;
  /** Rows that remain after the cleanup, per table, excluding the maintenance audit record written by the cleanup. */
  expectedAfter: Counts;
  userIds: string[];
  profileIds: string[];
  bookIds: string[];
  ticketIds: string[];
  /** Opaque storage keys of attachment rows that would be removed. */
  attachmentKeys: string[];
  protectedAdminIds: string[];
  excluded: ExcludedIdentity[];
  /** Audit rows are kept untouched, except that rows acted by a deleted user lose the actor id (ON DELETE SET NULL). */
  auditRowsActorNulled: number;
  blockers: string[];
  /** Short digest of exactly what would be deleted. Execution requires the value shown by the preview. */
  token: string;
}

const emptyCounts = (): Counts => Object.fromEntries(TABLES.map((t) => [t, 0])) as Counts;

export async function tableCounts(db: Db): Promise<Counts> {
  const [users, authorProfiles, books, sessions, tickets, ticketMessages, internalNotes, ticketAssignments, aiAnalyses, ticketAttachments, auditLogs] = await Promise.all([
    db.user.count(), db.authorProfile.count(), db.book.count(), db.session.count(), db.ticket.count(), db.ticketMessage.count(),
    db.internalNote.count(), db.ticketAssignment.count(), db.aiAnalysis.count(), db.ticketAttachment.count(), db.auditLog.count()
  ]);
  return { users, authorProfiles, books, sessions, tickets, ticketMessages, internalNotes, ticketAssignments, aiAnalyses, ticketAttachments, auditLogs };
}

/** Read-only. Safe to run any time against any database. */
export async function planCleanup(db: Db, whitelist: readonly string[] = SYNTHETIC_AUTHOR_EMAILS): Promise<CleanupPlan> {
  const blockers: string[] = [];
  const excluded: ExcludedIdentity[] = [];
  const totals = await tableCounts(db);

  const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  const protectedAdminIds = admins.map((a) => a.id).sort();

  const candidates = await db.user.findMany({
    where: { email: { in: [...whitelist] } },
    select: { id: true, role: true, authorProfile: { select: { id: true, externalAuthorId: true, books: { select: { id: true, externalBookId: true } } } } }
  });

  const userIds: string[] = [];
  const profileIds: string[] = [];
  const bookIds: string[] = [];
  for (const user of candidates) {
    const profile = user.authorProfile;
    if (user.role !== "AUTHOR") excluded.push({ userId: user.id, reason: "whitelisted email but role is not AUTHOR" });
    else if (!profile) excluded.push({ userId: user.id, reason: "whitelisted email but no author profile" });
    else if (!SYNTHETIC_AUTHOR_ID.test(profile.externalAuthorId)) excluded.push({ userId: user.id, reason: "whitelisted email but external author id is not synthetic" });
    else if (profile.books.some((b) => !SYNTHETIC_BOOK_ID.test(b.externalBookId))) excluded.push({ userId: user.id, reason: "owns a book whose external id is not synthetic" });
    else {
      userIds.push(user.id);
      profileIds.push(profile.id);
      bookIds.push(...profile.books.map((b) => b.id));
    }
  }
  userIds.sort(); profileIds.sort(); bookIds.sort();

  const tickets = profileIds.length ? await db.ticket.findMany({ where: { authorId: { in: profileIds } }, select: { id: true } }) : [];
  const ticketIds = tickets.map((t) => t.id).sort();
  if (ticketIds.length > MAX_IDS || bookIds.length > MAX_IDS) blockers.push(`more than ${MAX_IDS} records selected; refusing to build an unbounded delete`);

  const inTickets = { ticketId: { in: ticketIds } };
  const allowedActors = [...userIds, ...protectedAdminIds];
  const toDelete = emptyCounts();
  toDelete.users = userIds.length;
  toDelete.authorProfiles = profileIds.length;
  toDelete.books = bookIds.length;
  toDelete.tickets = ticketIds.length;

  let attachmentKeys: string[] = [];
  let auditRowsActorNulled = 0;
  if (ticketIds.length > 0 || userIds.length > 0) {
    [toDelete.ticketMessages, toDelete.internalNotes, toDelete.ticketAssignments, toDelete.aiAnalyses, toDelete.ticketAttachments] = await Promise.all([
      db.ticketMessage.count({ where: inTickets }), db.internalNote.count({ where: inTickets }), db.ticketAssignment.count({ where: inTickets }),
      db.aiAnalysis.count({ where: inTickets }), db.ticketAttachment.count({ where: inTickets })
    ]);
    toDelete.sessions = await db.session.count({ where: { userId: { in: userIds } } });
    attachmentKeys = (await db.ticketAttachment.findMany({ where: inTickets, select: { storageKey: true } })).map((a) => a.storageKey).sort();

    // Anything in scope that was written by someone who is neither a deletable identity nor the admin is unclassified: stop.
    const [foreignMessages, foreignNotes, foreignAttachments, foreignAssignments, foreignBookTickets, scatteredMessages, scatteredNotes, scatteredAttachments, scatteredAssignments] = await Promise.all([
      db.ticketMessage.count({ where: { ...inTickets, authorId: { notIn: allowedActors } } }),
      db.internalNote.count({ where: { ...inTickets, authorId: { notIn: allowedActors } } }),
      db.ticketAttachment.count({ where: { ...inTickets, uploaderId: { notIn: allowedActors } } }),
      db.ticketAssignment.count({ where: { ...inTickets, assignedById: { notIn: allowedActors } } }),
      bookIds.length ? db.ticket.count({ where: { bookId: { in: bookIds }, authorId: { notIn: profileIds } } }) : Promise.resolve(0),
      // RESTRICT foreign keys: a deletable user must not have written anything outside the tickets being removed.
      db.ticketMessage.count({ where: { authorId: { in: userIds }, ticketId: { notIn: ticketIds } } }),
      db.internalNote.count({ where: { authorId: { in: userIds }, ticketId: { notIn: ticketIds } } }),
      db.ticketAttachment.count({ where: { uploaderId: { in: userIds }, ticketId: { notIn: ticketIds } } }),
      db.ticketAssignment.count({ where: { assignedById: { in: userIds }, ticketId: { notIn: ticketIds } } })
    ]);
    if (foreignMessages) blockers.push(`${foreignMessages} message(s) on synthetic tickets were written by an unclassified user`);
    if (foreignNotes) blockers.push(`${foreignNotes} internal note(s) on synthetic tickets were written by an unclassified user`);
    if (foreignAttachments) blockers.push(`${foreignAttachments} attachment(s) on synthetic tickets were uploaded by an unclassified user`);
    if (foreignAssignments) blockers.push(`${foreignAssignments} assignment(s) on synthetic tickets were made by an unclassified user`);
    if (foreignBookTickets) blockers.push(`${foreignBookTickets} ticket(s) of other authors reference a synthetic book`);
    if (scatteredMessages + scatteredNotes + scatteredAttachments + scatteredAssignments) blockers.push("a synthetic user wrote records on tickets outside the synthetic set");

    // Audit rows are evidence: counted for the report, never deleted (toDelete.auditLogs stays 0).
    auditRowsActorNulled = await db.auditLog.count({ where: { actorId: { in: userIds } } });
  }

  const expectedAfter = Object.fromEntries(TABLES.map((t) => [t, totals[t] - toDelete[t]])) as Counts;
  const digest = createHash("sha256").update(JSON.stringify({ userIds, profileIds, bookIds, ticketIds, attachmentKeys, toDelete, excluded, protectedAdminIds })).digest("hex");
  return {
    totals, toDelete, expectedAfter, userIds, profileIds, bookIds, ticketIds, attachmentKeys, protectedAdminIds, excluded,
    auditRowsActorNulled, blockers, token: digest.slice(0, 16)
  };
}

export interface ExecuteOptions {
  /** The token printed by the preview. */
  confirm: string;
  /** Timestamp of the verified backup taken for this operation, e.g. 20261016T054443Z. Recorded in the audit trail. */
  backupStamp: string;
}

export interface ExecuteResult {
  before: Counts;
  after: Counts;
  deleted: Counts;
  token: string;
}

export async function executeCleanup(prisma: PrismaClient, options: ExecuteOptions, whitelist: readonly string[] = SYNTHETIC_AUTHOR_EMAILS): Promise<ExecuteResult> {
  if (!backupStampPattern.test(options.backupStamp)) throw new CleanupError("backup stamp must look like 20261016T054443Z");
  if (!/^[a-f0-9]{16}$/.test(options.confirm)) throw new CleanupError("confirmation token must be the 16-character value printed by the dry run");

  return prisma.$transaction(async (tx) => {
    const plan = await planCleanup(tx, whitelist);
    if (plan.blockers.length > 0) throw new CleanupError(`blocked: ${plan.blockers.join("; ")}`);
    if (plan.token !== options.confirm) throw new CleanupError("the data changed since the preview (token mismatch); run the dry run again and re-approve");
    if (plan.userIds.length === 0) throw new CleanupError("nothing to clean up");

    const before = plan.totals;
    const adminsBefore = plan.protectedAdminIds;

    // Dependency order (see docs/release/FINAL_CLEANUP_INVENTORY.md): tickets first (their messages, notes, assignments,
    // AI attempts and attachment rows cascade), books before profiles (RESTRICT), users last (profiles and sessions cascade).
    await tx.ticket.deleteMany({ where: { id: { in: plan.ticketIds } } });
    await tx.book.deleteMany({ where: { id: { in: plan.bookIds } } });
    await tx.user.deleteMany({ where: { id: { in: plan.userIds } } });

    const after = await tableCounts(tx);
    const mismatches = TABLES.filter((t) => after[t] !== plan.expectedAfter[t]);
    if (mismatches.length > 0) throw new CleanupError(`post-delete verification failed for: ${mismatches.join(", ")}`);
    const adminsAfter = (await tx.user.findMany({ where: { role: "ADMIN" }, select: { id: true } })).map((a) => a.id).sort();
    if (JSON.stringify(adminsAfter) !== JSON.stringify(adminsBefore)) throw new CleanupError("admin set changed; rolled back");
    if ((await tx.user.count({ where: { id: { in: plan.userIds } } })) !== 0) throw new CleanupError("synthetic users remain; rolled back");

    // The audit log itself is untouched; this adds one aggregate-only record (counts and the backup stamp, no ids, no text).
    await tx.auditLog.create({
      data: {
        actorId: null, action: "maintenance.synthetic_cleanup", entityType: "System", entityId: `cleanup-${plan.token}`,
        after: { token: plan.token, backupStamp: options.backupStamp, deleted: plan.toDelete, kept: plan.expectedAfter }
      }
    });
    return { before, after: { ...after, auditLogs: after.auditLogs + 1 }, deleted: plan.toDelete, token: plan.token };
  }, { isolationLevel: "Serializable", timeout: 120_000, maxWait: 10_000 });
}

export interface FileReport {
  directoryReadable: boolean;
  present: number;
  missing: number;
  /** Files in the directory that no attachment row refers to. Reported only; never deleted by this tool. */
  unreferencedFiles: number;
}

function safePath(root: string, key: string): string {
  if (!storageKeyPattern.test(key)) throw new CleanupError("refusing an attachment key that is not a 48-character hex string");
  const path = resolve(root, key);
  if (!path.startsWith(resolve(root) + sep)) throw new CleanupError("attachment key escapes the storage directory");
  return path;
}

export async function inspectAttachmentFiles(db: Db, directory: string, keys: readonly string[]): Promise<FileReport> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return { directoryReadable: false, present: 0, missing: keys.length, unreferencedFiles: 0 };
  }
  const onDisk = new Set(names);
  const referenced = new Set((await db.ticketAttachment.findMany({ select: { storageKey: true } })).map((a) => a.storageKey));
  return {
    directoryReadable: true,
    present: keys.filter((k) => onDisk.has(k)).length,
    missing: keys.filter((k) => !onDisk.has(k)).length,
    unreferencedFiles: names.filter((n) => !referenced.has(n)).length
  };
}

/** Call only after executeCleanup committed. A file that is already gone counts as removed. */
export async function deleteAttachmentFiles(directory: string, keys: readonly string[]): Promise<{ removed: number }> {
  let removed = 0;
  for (const key of keys) {
    await rm(safePath(directory, key), { force: true });
    removed += 1;
  }
  return { removed };
}
