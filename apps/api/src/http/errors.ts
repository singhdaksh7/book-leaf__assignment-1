import type { ApiError } from "@bookleaf/contracts";

export type ErrorCode = "VALIDATION_ERROR" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED" | "INTERNAL_ERROR";

const statusByCode: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500
};

/** An error that is safe to show to the client: message and details are authored, never copied from exceptions. */
export class AppError extends Error {
  readonly status: number;
  readonly headers: Record<string, string>;
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown, headers: Record<string, string> = {}) {
    super(message);
    this.name = "AppError";
    this.status = statusByCode[code];
    this.headers = headers;
  }
}

export const validationError = (message: string, details?: unknown) => new AppError("VALIDATION_ERROR", message, details);
export const unauthenticated = (message = "Authentication is required") => new AppError("UNAUTHENTICATED", message);
export const forbidden = (message = "You do not have access to this resource") => new AppError("FORBIDDEN", message);
export const notFound = (message = "Resource not found") => new AppError("NOT_FOUND", message);

export function errorBody(error: AppError, requestId: string | undefined): ApiError {
  return { error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}), ...(requestId ? { requestId } : {}) } };
}
