import { randomBytes } from "node:crypto";
import { Router, type Response } from "express";
import { loginRequestSchema, loginResponseSchema, meResponseSchema, registerRequestSchema, registerResponseSchema } from "@bookleaf/contracts";
import type { PrismaClient } from "@bookleaf/db";
import { hashPassword, verifyPassword } from "@bookleaf/db/password";
import type { AppConfig } from "../config.js";
import { AppError, forbidden, unauthenticated } from "../http/errors.js";
import type { Logger } from "../http/logger.js";
import { asyncHandler, parseInput } from "../http/validate.js";
import { serializeCurrentUser } from "../serializers.js";
import { assertTrustedOrigin, requireAuth } from "./middleware.js";
import { FailureLimiter } from "./rateLimit.js";
import { createSession, csrfTokenFor, revokeSession } from "./sessions.js";

export interface AuthRouterOptions {
  prisma: PrismaClient;
  config: AppConfig;
  logger: Logger;
  /** Called after a session is revoked so open event streams bound to it are closed. */
  onSessionEnded?: (sessionId: string) => void;
  /** Test hook: cheaper Argon2 parameters for the timing-equalising dummy hash only. Real hashes carry their own parameters. */
  dummyHashCost?: { memoryCost: number; timeCost: number };
}

export function createAuthRouter({ prisma, config, logger, onSessionEnded, dummyHashCost }: AuthRouterOptions): Router {
  const router = Router();
  const ipLimiter = new FailureLimiter(config.loginMaxFailures * 3, config.loginFailureWindowMs);
  const accountLimiter = new FailureLimiter(config.loginMaxFailures, config.loginFailureWindowMs);
  // Registration counts every attempt (valid or not): the limiter's "failure" is simply one use of the allowance.
  const registerWindowMs = 60 * 60_000;
  const registerIpLimiter = new FailureLimiter(config.registerLimitPerIpPerHour, registerWindowMs);
  const registerGlobalLimiter = new FailureLimiter(config.registerLimitGlobalPerHour, registerWindowMs);

  // Verifying against a dummy hash when the email is unknown keeps response time independent of account existence.
  let dummyHash: Promise<string> | undefined;
  const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex"), dummyHashCost));

  const cookieBase = { secure: config.isProduction, sameSite: "lax", path: "/" } as const;

  function setSessionCookies(res: Response, token: string, sessionId: string, expiresAt: Date): void {
    res.cookie(config.sessionCookieName, token, { ...cookieBase, httpOnly: true, expires: expiresAt });
    // Readable by the SPA so it can echo the value in X-CSRF-Token. It is useless without the HttpOnly session cookie.
    res.cookie(config.csrfCookieName, csrfTokenFor(config.sessionSecret, sessionId), { ...cookieBase, httpOnly: false, expires: expiresAt });
  }

  function clearSessionCookies(res: Response): void {
    res.clearCookie(config.sessionCookieName, { ...cookieBase, httpOnly: true });
    res.clearCookie(config.csrfCookieName, { ...cookieBase, httpOnly: false });
  }

  router.post("/login", asyncHandler(async (req, res) => {
    // Login CSRF: the request has no session yet, so the origin check is the guard.
    assertTrustedOrigin(req, config);
    const { email: rawEmail, password } = parseInput(loginRequestSchema, req.body, "login request");
    const email = rawEmail.trim().toLowerCase();

    const ipKey = `ip:${req.ip ?? "unknown"}`;
    const accountKey = `acct:${req.ip ?? "unknown"}:${email}`;
    const retryAfter = Math.max(ipLimiter.retryAfterSeconds(ipKey), accountLimiter.retryAfterSeconds(accountKey));
    if (retryAfter > 0) throw new AppError("RATE_LIMITED", "Too many failed sign-in attempts. Try again later.", undefined, { "Retry-After": String(retryAfter) });

    const user = await prisma.user.findUnique({ where: { email }, include: { authorProfile: true } });
    const passwordOk = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
    if (!user || !passwordOk) {
      ipLimiter.recordFailure(ipKey);
      accountLimiter.recordFailure(accountKey);
      logger.log("warn", "login failed", { requestId: req.requestId });
      throw unauthenticated("Invalid email or password");
    }

    accountLimiter.reset(accountKey);
    const { token, sessionId, expiresAt } = await createSession(prisma, user.id, config.sessionTtlMs);
    setSessionCookies(res, token, sessionId, expiresAt);
    const auth = { sessionId, expiresAt, user, authorProfile: user.authorProfile };
    res.status(200).json(loginResponseSchema.parse({ user: serializeCurrentUser(auth) }));
  }));

  /**
   * Public author self-registration. The role is fixed to AUTHOR here and is not part of the request contract (the schema
   * is strict, so a supplied role/privilege field is a 400). Admin accounts exist only through the administrative process.
   */
  router.post("/register", asyncHandler(async (req, res) => {
    // Like login, there is no session yet, so the Origin check is the CSRF guard.
    assertTrustedOrigin(req, config);
    if (req.auth) throw forbidden("Sign out before creating another account");

    const ipKey = `reg:${req.ip ?? "unknown"}`;
    const retryAfter = Math.max(registerIpLimiter.retryAfterSeconds(ipKey), registerGlobalLimiter.retryAfterSeconds("reg:global"));
    if (retryAfter > 0) throw new AppError("RATE_LIMITED", "Too many sign-up attempts. Try again later.", undefined, { "Retry-After": String(retryAfter) });
    registerIpLimiter.recordFailure(ipKey);
    registerGlobalLimiter.recordFailure("reg:global");

    const { name, email, password } = parseInput(registerRequestSchema, req.body, "registration request");

    // Hash before touching the database so the response time does not depend on whether the email already exists.
    const passwordHash = await hashPassword(password);
    const joinedDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

    let created: Awaited<ReturnType<typeof createAuthor>> | undefined;
    // The unique index on User.email is the only duplicate guard (no check-then-insert race). The external id is random;
    // a collision on it (practically impossible) is retried instead of surfacing as a conflict.
    for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
      try {
        created = await createAuthor(email, passwordHash, name, joinedDate);
      } catch (error) {
        const target = uniqueViolationTarget(error);
        if (target === undefined) throw error;
        if (target.includes("email")) {
          logger.log("warn", "registration rejected: duplicate", { requestId: req.requestId });
          throw new AppError("CONFLICT", "We could not create an account with these details. If you already have an account, sign in instead.");
        }
      }
    }
    if (!created) throw new AppError("INTERNAL_ERROR", "An unexpected error occurred");

    const { token, sessionId, expiresAt } = await createSession(prisma, created.id, config.sessionTtlMs);
    setSessionCookies(res, token, sessionId, expiresAt);
    const auth = { sessionId, expiresAt, user: created, authorProfile: created.authorProfile };
    res.status(201).json(registerResponseSchema.parse({ user: serializeCurrentUser(auth) }));
  }));

  async function createAuthor(email: string, passwordHash: string, name: string, joinedDate: Date) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email, passwordHash, role: "AUTHOR",
          // Profile columns the person has not provided are empty strings, not invented values.
          authorProfile: { create: { externalAuthorId: `WEB-${randomBytes(8).toString("hex").toUpperCase()}`, name, phone: "", city: "", joinedDate } }
        },
        include: { authorProfile: true }
      });
      await tx.auditLog.create({ data: { actorId: user.id, action: "user.registered", entityType: "User", entityId: user.id, after: { role: "AUTHOR" } } });
      return user;
    });
  }

  router.post("/logout", requireAuth, asyncHandler(async (req, res) => {
    await revokeSession(prisma, req.auth!.sessionId);
    onSessionEnded?.(req.auth!.sessionId);
    clearSessionCookies(res);
    res.status(204).end();
  }));

  router.get("/me", requireAuth, (req, res) => {
    const auth = req.auth!;
    // Re-issue the CSRF cookie so a client that lost it (or opens a new tab) can recover without logging in again.
    res.cookie(config.csrfCookieName, csrfTokenFor(config.sessionSecret, auth.sessionId), { ...cookieBase, httpOnly: false, expires: auth.expiresAt });
    res.status(200).json(meResponseSchema.parse({ user: serializeCurrentUser(auth) }));
  });

  return router;
}

/** Field names of a unique-constraint violation (Prisma P2002), or undefined for any other error. */
function uniqueViolationTarget(error: unknown): string[] | undefined {
  if (typeof error !== "object" || error === null || (error as { code?: unknown }).code !== "P2002") return undefined;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map(String);
  return typeof target === "string" ? [target] : [];
}
