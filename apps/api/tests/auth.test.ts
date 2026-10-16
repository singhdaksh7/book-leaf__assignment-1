import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { apiErrorSchema, loginResponseSchema } from "@bookleaf/contracts";
import { PrismaClient } from "@bookleaf/db";
import { hashSessionToken } from "../src/auth/sessions.js";
import { ADMIN_EMAIL, TEST_PASSWORD, WEB_ORIGIN, cookieValue, createTestApp, loadSyntheticDataset, login, rawCookie, resetDatabase, seedSynthetic } from "./helpers.js";

const prisma = new PrismaClient();
const { app, config } = createTestApp(prisma);
const authorEmail = () => loadSyntheticDataset()[0]!.email;

beforeAll(async () => {
  await resetDatabase(prisma);
});
beforeEach(async () => {
  await resetDatabase(prisma);
  await seedSynthetic(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const loginRequest = (body: unknown, origin: string | undefined = WEB_ORIGIN) => {
  const req = request(app).post("/api/v1/auth/login");
  return (origin ? req.set("Origin", origin) : req).send(body as object);
};

describe("POST /auth/login", () => {
  it("logs an author in and returns a contract-valid user without private fields", async () => {
    const response = await loginRequest({ email: authorEmail(), password: TEST_PASSWORD });
    expect(response.status).toBe(200);
    const parsed = loginResponseSchema.parse(response.body);
    expect(parsed.user.role).toBe("AUTHOR");
    expect(parsed.user.authorProfile).toMatchObject({ externalAuthorId: "SYN-A001" });
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|argon2|tokenHash/);
  });

  it("accepts an email with surrounding whitespace (regression: whitespace used to be rejected as an invalid email)", async () => {
    const response = await loginRequest({ email: `  ${authorEmail().toUpperCase()}	`, password: TEST_PASSWORD });
    expect(response.status).toBe(200);
    expect(loginResponseSchema.parse(response.body).user.role).toBe("AUTHOR");
  });

  it("logs an admin in with a null author profile", async () => {
    const response = await loginRequest({ email: ADMIN_EMAIL, password: TEST_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ role: "ADMIN", authorProfile: null });
  });

  it("matches email case-insensitively", async () => {
    const response = await loginRequest({ email: `  ${authorEmail().toUpperCase()} `.trim(), password: TEST_PASSWORD });
    expect(response.status).toBe(200);
  });

  it("sets an HttpOnly SameSite=Lax session cookie and a readable CSRF cookie; Secure only in production", async () => {
    const response = await loginRequest({ email: authorEmail(), password: TEST_PASSWORD });
    const session = rawCookie(response.headers["set-cookie"], config.sessionCookieName)!;
    const csrf = rawCookie(response.headers["set-cookie"], config.csrfCookieName)!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).toMatch(/Expires=/i);
    expect(session).not.toMatch(/Secure/i);
    expect(csrf).not.toMatch(/HttpOnly/i);

    const production = createTestApp(prisma, { NODE_ENV: "production", WEB_ORIGIN: "https://portal.example.com", SESSION_SECRET: "prod-secret-prod-secret-prod-secret-0123456789" });
    const prodResponse = await request(production.app).post("/api/v1/auth/login").set("Origin", "https://portal.example.com").send({ email: authorEmail(), password: TEST_PASSWORD });
    expect(prodResponse.status).toBe(200);
    expect(rawCookie(prodResponse.headers["set-cookie"], production.config.sessionCookieName)).toMatch(/Secure/);
    expect(rawCookie(prodResponse.headers["set-cookie"], production.config.csrfCookieName)).toMatch(/Secure/);
  });

  it("stores only a hash of the session token and an Argon2id password hash", async () => {
    const response = await loginRequest({ email: authorEmail(), password: TEST_PASSWORD });
    const token = cookieValue(response.headers["set-cookie"], config.sessionCookieName)!;
    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(hashSessionToken(token));
    expect(sessions[0]!.tokenHash).not.toBe(token);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: authorEmail() } });
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    const wrong = await loginRequest({ email: authorEmail(), password: "definitely wrong password" });
    const unknown = await loginRequest({ email: "nobody@example.test", password: "definitely wrong password" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toMatchObject({ code: "UNAUTHENTICATED", message: unknown.body.error.message });
    expect(wrong.headers["set-cookie"]).toBeUndefined();
    expect(apiErrorSchema.safeParse(wrong.body).success).toBe(true);
  });

  it("validates the body with the shared envelope and never echoes the password", async () => {
    const response = await loginRequest({ email: "not-an-email", password: "secret-value-123" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.requestId).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toContain("secret-value-123");
    expect((await loginRequest({})).status).toBe(400);
    const malformed = await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).set("Content-Type", "application/json").send("{not json");
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects cross-origin login attempts (login CSRF)", async () => {
    const foreign = await loginRequest({ email: authorEmail(), password: TEST_PASSWORD }, "https://evil.example.com");
    expect(foreign.status).toBe(403);
    expect(foreign.headers["set-cookie"]).toBeUndefined();
    const crossSite = await request(app).post("/api/v1/auth/login").set("Sec-Fetch-Site", "cross-site").send({ email: authorEmail(), password: TEST_PASSWORD });
    expect(crossSite.status).toBe(403);
  });

  it("throttles repeated failures with 429 and Retry-After, then blocks even the right password", async () => {
    // Own app instance: the limiter is in-memory per app, so this cannot affect other tests.
    const limited = createTestApp(prisma, { LOGIN_MAX_FAILURES: "3" }).app;
    const attempt = (password: string) => request(limited).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: authorEmail(), password });
    for (let i = 0; i < 3; i += 1) expect((await attempt("wrong password!")).status).toBe(401);
    const blocked = await attempt(TEST_PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("sessions", () => {
  it("GET /auth/me requires a session", async () => {
    const response = await request(app).get("/api/v1/auth/me");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("GET /auth/me returns the current user and refreshes the CSRF cookie", async () => {
    const { agent, csrf } = await login(app, config, authorEmail());
    const me = await agent.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(authorEmail());
    expect(cookieValue(me.headers["set-cookie"], config.csrfCookieName)).toBe(csrf);
    expect(me.headers["cache-control"]).toBe("no-store");
  });

  it("rejects unknown, tampered and expired session cookies", async () => {
    const forged = await request(app).get("/api/v1/auth/me").set("Cookie", `${config.sessionCookieName}=${"a".repeat(43)}`);
    expect(forged.status).toBe(401);

    const { agent } = await login(app, config, authorEmail());
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() + 1000), createdAt: new Date(Date.now() - 10_000) } });
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 10_000) } });
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("issues a fresh token per login (no fixation)", async () => {
    const first = await loginRequest({ email: authorEmail(), password: TEST_PASSWORD });
    const second = await loginRequest({ email: authorEmail(), password: TEST_PASSWORD });
    expect(cookieValue(first.headers["set-cookie"], config.sessionCookieName)).not.toBe(cookieValue(second.headers["set-cookie"], config.sessionCookieName));
  });
});

describe("POST /auth/logout and CSRF", () => {
  it("requires authentication", async () => {
    expect((await request(app).post("/api/v1/auth/logout").set("Origin", WEB_ORIGIN)).status).toBe(401);
  });

  it("rejects a cookie-authenticated mutation without the CSRF token, with a wrong one, or from a foreign origin", async () => {
    const { agent, csrf } = await login(app, config, authorEmail());
    expect((await agent.post("/api/v1/auth/logout").set("Origin", WEB_ORIGIN)).status).toBe(403);
    expect((await agent.post("/api/v1/auth/logout").set("Origin", WEB_ORIGIN).set("X-CSRF-Token", "wrong")).status).toBe(403);
    expect((await agent.post("/api/v1/auth/logout").set("Origin", "https://evil.example.com").set("X-CSRF-Token", csrf)).status).toBe(403);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);
  });

  it("does not accept another session's CSRF token", async () => {
    const a = await login(app, config, authorEmail());
    const b = await login(app, config, ADMIN_EMAIL);
    expect(a.csrf).not.toBe(b.csrf);
    expect((await a.agent.post("/api/v1/auth/logout").set("Origin", WEB_ORIGIN).set("X-CSRF-Token", b.csrf)).status).toBe(403);
  });

  it("revokes the session server-side and clears cookies", async () => {
    const { agent, csrf, response } = await login(app, config, authorEmail());
    const token = cookieValue(response.headers["set-cookie"], config.sessionCookieName)!;
    const out = await agent.post("/api/v1/auth/logout").set("Origin", WEB_ORIGIN).set("X-CSRF-Token", csrf);
    expect(out.status).toBe(204);
    expect(out.text).toBe("");
    expect(rawCookie(out.headers["set-cookie"], config.sessionCookieName)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await prisma.session.count()).toBe(0);
    // The old cookie value no longer works even if replayed manually.
    const replay = await request(app).get("/api/v1/auth/me").set("Cookie", `${config.sessionCookieName}=${token}`);
    expect(replay.status).toBe(401);
  });
});

describe("error envelope", () => {
  it("returns the standard 404 envelope for unknown routes", async () => {
    const response = await request(app).get("/api/v1/nope");
    expect(response.status).toBe(404);
    expect(apiErrorSchema.parse(response.body).error.code).toBe("NOT_FOUND");
  });

  it("echoes a valid X-Request-Id and generates one otherwise", async () => {
    const supplied = await request(app).get("/api/v1/auth/me").set("X-Request-Id", "req-12345678");
    expect(supplied.headers["x-request-id"]).toBe("req-12345678");
    expect(supplied.body.error.requestId).toBe("req-12345678");
    const bad = await request(app).get("/api/v1/auth/me").set("X-Request-Id", "bad id with spaces");
    expect(bad.headers["x-request-id"]).not.toBe("bad id with spaces");
  });

  it("does not leak internals on unexpected failures", async () => {
    const broken = new PrismaClient({ datasourceUrl: "postgresql://nobody:secret-pass@127.0.0.1:1/none?connect_timeout=1" });
    const { app: brokenApp } = createTestApp(broken);
    const response = await request(brokenApp).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: authorEmail(), password: TEST_PASSWORD });
    await broken.$disconnect();
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toMatch(/secret-pass|127\.0\.0\.1|prisma/i);
  });
});
