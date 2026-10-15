import { randomBytes } from "node:crypto";
import { Router, type Response } from "express";
import { loginRequestSchema, loginResponseSchema, meResponseSchema } from "@bookleaf/contracts";
import type { PrismaClient } from "@bookleaf/db";
import { hashPassword, verifyPassword } from "@bookleaf/db/password";
import type { AppConfig } from "../config.js";
import { AppError, unauthenticated } from "../http/errors.js";
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
