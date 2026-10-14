import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@bookleaf/db";
import type { AuthContext } from "../http/types.js";

/** 256-bit opaque token. Only its SHA-256 is stored, so a database leak does not yield usable sessions. */
export const generateSessionToken = (): string => randomBytes(32).toString("base64url");
export const hashSessionToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function createSession(prisma: PrismaClient, userId: string, ttlMs: number): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  const session = await prisma.session.create({ data: { tokenHash: hashSessionToken(token), userId, expiresAt } });
  // Opportunistic cleanup keeps the table small without a scheduler.
  await prisma.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
  return { token, sessionId: session.id, expiresAt };
}

/** Resolves a raw cookie token to an auth context, or null if unknown/expired. */
export async function findSessionContext(prisma: PrismaClient, token: string): Promise<AuthContext | null> {
  if (token.length < 20 || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { include: { authorProfile: true } } }
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  const { user } = session;
  return { sessionId: session.id, expiresAt: session.expiresAt, user: { id: user.id, email: user.email, role: user.role }, authorProfile: user.authorProfile };
}

export async function revokeSession(prisma: PrismaClient, sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

/** Stateless CSRF token bound to one session: HMAC(secret, sessionId). It dies with the session. */
export const csrfTokenFor = (secret: string, sessionId: string): string => createHmac("sha256", secret).update(`csrf:${sessionId}`).digest("base64url");

export function csrfTokenMatches(expected: string, provided: unknown): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
