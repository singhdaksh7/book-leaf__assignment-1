import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import helmet from "helmet";
import type { PrismaClient } from "@bookleaf/db";
import { authenticate, CSRF_HEADER, csrfProtection } from "./auth/middleware.js";
import { createAuthRouter } from "./auth/routes.js";
import type { AppConfig } from "./config.js";
import { AppError, errorBody, notFound } from "./http/errors.js";
import { silentLogger, type Logger } from "./http/logger.js";
import "./http/types.js";
import { LocalDiskStorage, type AttachmentStorage } from "./attachments/storage.js";
import { createAdminRouter } from "./routes/admin.js";
import { createAuthorRouter } from "./routes/author.js";
import { createEventsRouter } from "./routes/events.js";
import { AiAttemptService } from "./ai/attempts.js";
import { createUnavailableEngine } from "./ai/engine.js";
import { TicketEventHub } from "./events/hub.js";
import type { TicketHooks } from "./tickets/hooks.js";

export interface AppDependencies {
  config: AppConfig;
  prisma: PrismaClient;
  logger?: Logger;
  /** Attachment store; defaults to local disk under config.attachmentDir. */
  storage?: AttachmentStorage;
  /** Post-commit extension points. */
  hooks?: TicketHooks;
  /** AI attempt service. When provided, every new ticket gets a durable PENDING attempt and is analysed in the background. */
  ai?: AiAttemptService;
  /** Event hub shared with the AI service so analysis completion reaches admin streams. */
  events?: TicketEventHub;
  /** SSE keep-alive/session re-validation period (tests shorten it). */
  sseHeartbeatMs?: number;
  /** Test hook: lower Argon2 cost for the login timing-equalisation hash. */
  dummyHashCost?: { memoryCost: number; timeCost: number };
}

const requestIdPattern = /^[A-Za-z0-9_-]{8,64}$/;

export function createApp({ config, prisma, logger = silentLogger, storage = new LocalDiskStorage(config.attachmentDir), hooks, ai, events = new TicketEventHub(), sseHeartbeatMs, dummyHashCost }: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  const withRequestId: RequestHandler = (req, res, next) => {
    const supplied = req.headers["x-request-id"];
    req.requestId = typeof supplied === "string" && requestIdPattern.test(supplied) ? supplied : randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    next();
  };

  const accessLog: RequestHandler = (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      // Path only (no query string), no headers, no bodies.
      logger.log("info", "request", {
        requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode,
        durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6), userId: req.auth?.user.id
      });
    });
    next();
  };

  const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  };

  app.use(withRequestId, accessLog);
  app.use(helmet());
  app.use(cors({ origin: config.webOrigin, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], allowedHeaders: ["Content-Type", CSRF_HEADER, "X-Request-Id", "Last-Event-ID"], maxAge: 600 }));
  app.use(express.json({ limit: "100kb" }));
  // @types/cookie-parser is typed against a different @types/express major; the runtime handler is a standard middleware.
  app.use(cookieParser() as unknown as RequestHandler);

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  const v1 = express.Router();
  v1.use(noStore);
  v1.use(authenticate(prisma, config));
  v1.use(csrfProtection(config));
  // Without an injected service, admin-requested analyses still work but record "not configured"; nothing runs on ticket creation.
  const aiService = ai ?? new AiAttemptService({ prisma, engine: createUnavailableEngine(), events, logger });
  v1.use("/auth", createAuthRouter({ prisma, config, logger, onSessionEnded: (id) => events.closeSession(id), dummyHashCost }));
  v1.use("/author", createAuthorRouter({ prisma, config, storage, logger, hooks, events, ai }));
  v1.use("/admin", createAdminRouter({ prisma, storage, events, ai: aiService }));
  v1.use("/events", createEventsRouter({ prisma, hub: events, heartbeatMs: sseHeartbeatMs }));
  v1.use((_req, _res, next) => next(notFound("Route not found")));
  app.use("/api/v1", v1);
  app.use((_req, _res, next) => next(notFound("Route not found")));

  const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
    if (res.headersSent) {
      // A stream (SSE) or partial response is already on the wire: nothing safe can be added.
      logger.log("error", "error after headers sent", { requestId: req.requestId, errorName: err instanceof Error ? err.name : typeof err });
      res.end();
      return;
    }
    let appError: AppError;
    if (err instanceof AppError) {
      appError = err;
    } else if (typeof err === "object" && err !== null && "type" in err && ((err as { type: string }).type === "entity.parse.failed" || (err as { type: string }).type === "entity.too.large")) {
      appError = new AppError("VALIDATION_ERROR", (err as { type: string }).type === "entity.too.large" ? "Request body is too large" : "Request body is not valid JSON");
    } else {
      appError = new AppError("INTERNAL_ERROR", "An unexpected error occurred");
      // Error name and Prisma code only: messages can contain query parameters or personal records.
      logger.log("error", "unhandled error", {
        requestId: req.requestId, errorName: err instanceof Error ? err.name : typeof err,
        errorCode: typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : undefined
      });
    }
    for (const [name, value] of Object.entries(appError.headers)) res.setHeader(name, value);
    res.status(appError.status).json(errorBody(appError, req.requestId));
  };
  app.use(errorHandler);

  return app;
}
