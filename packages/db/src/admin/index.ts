/**
 * The only supported way to create or rotate an administrator. It runs on the server (shell access to the API
 * container), reads the email and password from the environment, never from a web request, and never promotes an
 * existing author. There is no default admin account or password anywhere in the code.
 */
import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "../password.js";

export class AdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminError";
  }
}

export interface EnsureAdminInput {
  email: string;
  password: string;
  /** Required to change the password of an admin that already exists. */
  rotatePassword?: boolean;
  hash?: (password: string) => Promise<string>;
}

export interface EnsureAdminResult {
  action: "created" | "password-rotated";
  userId: string;
  sessionsRevoked: number;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Same minimum as public registration (12-128 characters with upper, lower and a digit), kept local to avoid a package cycle. */
export function adminPasswordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 12) issues.push("at least 12 characters");
  if (password.length > 128) issues.push("at most 128 characters");
  if (!/[a-z]/.test(password)) issues.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) issues.push("an uppercase letter");
  if (!/[0-9]/.test(password)) issues.push("a number");
  return issues;
}

export async function ensureAdmin(prisma: PrismaClient, input: EnsureAdminInput): Promise<EnsureAdminResult> {
  const email = input.email.trim().toLowerCase();
  if (!emailPattern.test(email) || email.length > 254) throw new AdminError("A valid admin email is required");
  const issues = adminPasswordIssues(input.password);
  if (issues.length > 0) throw new AdminError(`Admin password needs: ${issues.join(", ")}`);
  const passwordHash = await (input.hash ?? ((p: string) => hashPassword(p)))(input.password);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing && existing.role !== "ADMIN") throw new AdminError("That email belongs to an author account; authors are never promoted to admin");
    if (existing) {
      if (!input.rotatePassword) throw new AdminError("That admin already exists. Pass --rotate-password to change its password.");
      await tx.user.update({ where: { id: existing.id }, data: { passwordHash } });
      // A rotated password must end every session that was opened with the old one.
      const { count } = await tx.session.deleteMany({ where: { userId: existing.id } });
      await tx.auditLog.create({ data: { actorId: null, action: "admin.password_rotated", entityType: "User", entityId: existing.id, after: { sessionsRevoked: count } } });
      return { action: "password-rotated" as const, userId: existing.id, sessionsRevoked: count };
    }
    const created = await tx.user.create({ data: { email, passwordHash, role: "ADMIN" } });
    await tx.auditLog.create({ data: { actorId: null, action: "admin.created", entityType: "User", entityId: created.id, after: { role: "ADMIN" } } });
    return { action: "created" as const, userId: created.id, sessionsRevoked: 0 };
  });
}
