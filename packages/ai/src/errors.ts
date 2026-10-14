export type AiErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_TIMEOUT"
  | "AI_RATE_LIMITED"
  | "AI_PROVIDER_ERROR"
  | "AI_NETWORK_ERROR"
  | "AI_INVALID_OUTPUT"
  | "AI_UNGROUNDED_OUTPUT";

/** Safe-to-store failure. `message` never contains prompts, provider bodies or secrets; `code` is a stable sanitized value. */
export class AiUnavailableError extends Error {
  readonly code: AiErrorCode;
  constructor(message = "AI service is unavailable", code: AiErrorCode = "AI_PROVIDER_ERROR") {
    super(message);
    this.name = "AiUnavailableError";
    this.code = code;
  }
}
