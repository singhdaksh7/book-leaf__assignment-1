import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodTypeAny, z } from "zod";
import { validationError } from "./errors.js";

/** Parses untrusted input. Issue details carry paths and Zod's generic messages only, never the submitted values. */
export function parseInput<S extends ZodTypeAny>(schema: S, input: unknown, label: string): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw validationError(`Invalid ${label}`, result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  return result.data;
}

/** Express 4 does not forward rejected promises to the error handler. */
export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
