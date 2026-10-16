import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { PrismaClient, UserRole } from "@bookleaf/db";
import type { AppConfig } from "../config.js";
import { forbidden, unauthenticated } from "../http/errors.js";
import { asyncHandler } from "../http/validate.js";
import { csrfTokenFor, csrfTokenMatches, findSessionContext } from "./sessions.js";

export const CSRF_HEADER = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Attaches `req.auth` when the session cookie maps to a live session. Never rejects: routes opt in via require*. */
export function authenticate(prisma: PrismaClient, config: AppConfig): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const token = (req.cookies as Record<string, unknown> | undefined)?.[config.sessionCookieName];
    if (typeof token === "string" && token.length > 0) {
      const context = await findSessionContext(prisma, token);
      if (context) req.auth = context;
    }
    next();
  });
}

/**
 * Rejects cross-origin browser requests. A present Origin header must equal the configured web origin; for requests
 * that carry no Origin, a `Sec-Fetch-Site: cross-site` header is rejected. Non-browser clients send neither.
 */
export function assertTrustedOrigin(req: Request, config: AppConfig): void {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (origin !== config.webOrigin) throw forbidden("Request origin is not allowed");
    return;
  }
  if (req.headers["sec-fetch-site"] === "cross-site") throw forbidden("Request origin is not allowed");
}

/**
 * CSRF protection for state-changing, cookie-authenticated requests: trusted Origin plus a session-bound token that the
 * client echoes in `X-CSRF-Token` (double-submit: the token is also issued in a readable cookie). Unauthenticated
 * requests pass through so that `requireAuth` answers 401; login is guarded by `assertTrustedOrigin` in its own route.
 */
export function csrfProtection(config: AppConfig): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method) || !req.auth) return next();
    try {
      assertTrustedOrigin(req, config);
      if (!csrfTokenMatches(csrfTokenFor(config.sessionSecret, req.auth.sessionId), req.headers[CSRF_HEADER])) {
        throw forbidden("Missing or invalid CSRF token");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthenticated());
  next();
};

export const requireRole = (role: UserRole): RequestHandler => (req, _res, next) => {
  if (!req.auth) return next(unauthenticated());
  if (req.auth.user.role !== role) return next(forbidden());
  next();
};

/** Author-scoped routes need an AUTHOR user that actually has a profile; its id is the only scope used in queries. */
export const requireAuthor: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthenticated());
  if (req.auth.user.role !== "AUTHOR" || !req.auth.authorProfile) return next(forbidden());
  next();
};

/** The authenticated author's profile id, for use in every author-scoped query. */
export function authorProfileId(req: Request): string {
  const profile = req.auth?.authorProfile;
  if (!profile) throw forbidden();
  return profile.id;
}
