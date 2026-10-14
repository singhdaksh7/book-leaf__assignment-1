import { resolve } from "node:path";
import { z } from "zod";

const placeholderSecret = /replace-with|changeme|change-me|example/i;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_.-]+$/).default("bookleaf_session"),
  CSRF_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_.-]+$/).default("XSRF-TOKEN"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 7),
  WEB_ORIGIN: z.string().url(),
  /** "false" (default), "true", or a hop count when running behind a reverse proxy. */
  TRUST_PROXY: z.string().default("false"),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(10),
  LOGIN_FAILURE_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
  /** Directory for the local-disk attachment store. Must be outside any web-served path. */
  ATTACHMENT_DIR: z.string().min(1).default("var/attachments"),
  ATTACHMENT_MAX_BYTES: z.coerce.number().int().min(1).max(25 * 1024 * 1024).default(5 * 1024 * 1024),
  ATTACHMENT_MAX_PER_TICKET: z.coerce.number().int().min(1).max(50).default(5),
  TICKET_CREATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(30),
  AUTHOR_REPLY_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(60)
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  sessionCookieName: string;
  csrfCookieName: string;
  sessionSecret: string;
  sessionTtlMs: number;
  /** Normalised origin (no path or trailing slash) used for CORS and Origin checks. */
  webOrigin: string;
  trustProxy: boolean | number;
  loginMaxFailures: number;
  loginFailureWindowMs: number;
  /** Absolute path of the attachment directory. */
  attachmentDir: string;
  attachmentMaxBytes: number;
  attachmentMaxPerTicket: number;
  ticketCreateLimitPerHour: number;
  authorReplyLimitPerHour: number;
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration: ${issues.join("; ")}`);
    this.name = "ConfigError";
  }
}

/** Parses environment variables. Error messages name variables only; they never include values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  const value = parsed.data;
  const isProduction = value.NODE_ENV === "production";
  const issues: string[] = [];
  if (isProduction && placeholderSecret.test(value.SESSION_SECRET)) issues.push("SESSION_SECRET must not be a placeholder in production");
  if (isProduction && !value.WEB_ORIGIN.startsWith("https://")) issues.push("WEB_ORIGIN must use https in production");
  if (issues.length > 0) throw new ConfigError(issues);

  const trustProxy = value.TRUST_PROXY === "true" ? true : /^\d+$/.test(value.TRUST_PROXY) ? Number(value.TRUST_PROXY) : false;
  return {
    nodeEnv: value.NODE_ENV,
    isProduction,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    sessionCookieName: value.SESSION_COOKIE_NAME,
    csrfCookieName: value.CSRF_COOKIE_NAME,
    sessionSecret: value.SESSION_SECRET,
    sessionTtlMs: value.SESSION_TTL_HOURS * 3_600_000,
    webOrigin: new URL(value.WEB_ORIGIN).origin,
    trustProxy,
    loginMaxFailures: value.LOGIN_MAX_FAILURES,
    loginFailureWindowMs: value.LOGIN_FAILURE_WINDOW_MINUTES * 60_000,
    attachmentDir: resolve(value.ATTACHMENT_DIR),
    attachmentMaxBytes: value.ATTACHMENT_MAX_BYTES,
    attachmentMaxPerTicket: value.ATTACHMENT_MAX_PER_TICKET,
    ticketCreateLimitPerHour: value.TICKET_CREATE_LIMIT_PER_HOUR,
    authorReplyLimitPerHour: value.AUTHOR_REPLY_LIMIT_PER_HOUR
  };
}
