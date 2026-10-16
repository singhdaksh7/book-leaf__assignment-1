export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, message: string, fields?: Record<string, string | number | boolean | null | undefined>): void;
}

/**
 * Structured JSON logger. Callers pass only scalar, pre-vetted fields (ids, status, timings, error names). Request bodies,
 * headers, cookies, query strings and exception messages are never logged: they can hold credentials or personal records.
 */
export function createLogger(write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger {
  return {
    log(level, message, fields = {}) {
      write(JSON.stringify({ time: new Date().toISOString(), level, message, ...fields }));
    }
  };
}

export const silentLogger: Logger = { log() {} };
