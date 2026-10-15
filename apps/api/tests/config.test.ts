import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const base = { DATABASE_URL: "postgresql://u:p@localhost/db", SESSION_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" };

describe("loadConfig", () => {
  it("applies defaults and normalises the web origin", () => {
    const config = loadConfig({ ...base, WEB_ORIGIN: "http://localhost:5173/" });
    expect(config).toMatchObject({ port: 3000, isProduction: false, webOrigin: "http://localhost:5173", sessionCookieName: "bookleaf_session", trustProxy: false });
  });

  it("rejects short secrets and missing variables without echoing values", () => {
    let message = "";
    try {
      loadConfig({ DATABASE_URL: "postgresql://user:hunter2@localhost/db", SESSION_SECRET: "short-secret-value", WEB_ORIGIN: "not a url" });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      message = (error as Error).message;
    }
    expect(message).toContain("SESSION_SECRET");
    expect(message).toContain("WEB_ORIGIN");
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("short-secret-value");
  });

  it("refuses placeholder secrets and non-https origins in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production", SESSION_SECRET: "replace-with-a-long-random-secret-value-xx" })).toThrow(/placeholder/);
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/https/);
    expect(loadConfig({ ...base, NODE_ENV: "production", WEB_ORIGIN: "https://portal.example.com" }).isProduction).toBe(true);
  });

  it("parses TRUST_PROXY", () => {
    expect(loadConfig({ ...base, TRUST_PROXY: "1" }).trustProxy).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: "true" }).trustProxy).toBe(true);
  });
});
