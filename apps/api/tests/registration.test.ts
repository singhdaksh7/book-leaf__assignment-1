import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { apiErrorSchema, registerResponseSchema } from "@bookleaf/contracts";
import { PrismaClient } from "@bookleaf/db";
import { ADMIN_EMAIL, TEST_PASSWORD, WEB_ORIGIN, cookieValue, createTestApp, loadSyntheticDataset, login, mutate, rawCookie, resetDatabase, seedSynthetic } from "./helpers.js";

const prisma = new PrismaClient();
// Generous limits for functional tests; the rate-limit tests build their own apps.
const { app, config } = createTestApp(prisma, { REGISTER_LIMIT_PER_IP_PER_HOUR: "1000", REGISTER_LIMIT_GLOBAL_PER_HOUR: "1000" });

const GOOD_PASSWORD = "Sturdy-Pass-2026";
const valid = (overrides: Record<string, unknown> = {}) => ({
  name: "Asha Verma", email: "asha.verma@writers.test", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD, ...overrides
});

const register = (body: unknown, target = app, origin: string | undefined = WEB_ORIGIN) => {
  const req = request(target).post("/api/v1/auth/register");
  return (origin ? req.set("Origin", origin) : req).send(body as object);
};

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

const userCount = () => prisma.user.count();

describe("POST /auth/register: success", () => {
  it("creates an AUTHOR with a profile, returns a contract-valid user and signs the person in", async () => {
    const before = await userCount();
    const response = await register(valid());
    expect(response.status).toBe(201);
    const parsed = registerResponseSchema.parse(response.body);
    expect(parsed.user).toMatchObject({ email: "asha.verma@writers.test", role: "AUTHOR" });
    expect(parsed.user.authorProfile).toMatchObject({ name: "Asha Verma", phone: "", city: "" });
    expect(parsed.user.authorProfile!.externalAuthorId).toMatch(/^WEB-[0-9A-F]{16}$/);
    expect(await userCount()).toBe(before + 1);
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|argon2|tokenHash|\$argon/);

    const session = rawCookie(response.headers["set-cookie"], config.sessionCookieName)!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(rawCookie(response.headers["set-cookie"], config.csrfCookieName)).toBeTruthy();
  });

  it("stores an Argon2id hash (never the password) and records a registration audit event", async () => {
    await register(valid());
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "asha.verma@writers.test" } });
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(user.passwordHash).not.toContain(GOOD_PASSWORD);
    expect(user.role).toBe("AUTHOR");
    const audit = await prisma.auditLog.findMany({ where: { action: "user.registered", entityId: user.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBe(user.id);
    expect(JSON.stringify(audit[0])).not.toContain(GOOD_PASSWORD);
  });

  it("normalises the email (trim, lower-case) and the new person can sign in with any casing", async () => {
    const response = await register(valid({ email: "  Asha.Verma@Writers.TEST \t" }));
    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe("asha.verma@writers.test");
    const again = await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: "ASHA.VERMA@writers.test", password: GOOD_PASSWORD });
    expect(again.status).toBe(200);
  });

  it("creates a session that works for /me and ends on logout", async () => {
    const agent = request.agent(app);
    const response = await agent.post("/api/v1/auth/register").set("Origin", WEB_ORIGIN).send(valid());
    const csrf = cookieValue(response.headers["set-cookie"], config.csrfCookieName)!;
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);
    const out = await agent.post("/api/v1/auth/logout").set("Origin", WEB_ORIGIN).set("X-CSRF-Token", csrf);
    expect(out.status).toBe(204);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
  });
});

describe("POST /auth/register: validation", () => {
  it.each([
    ["missing email", { email: undefined }, "email"],
    ["invalid email", { email: "not-an-email" }, "email"],
    ["missing name", { name: undefined }, "name"],
    ["one-letter name", { name: "A" }, "name"],
    ["markup in name", { name: "<script>alert(1)</script>" }, "name"],
    ["missing password", { password: undefined, confirmPassword: undefined }, "password"],
    ["missing confirmation", { confirmPassword: undefined }, "confirmPassword"],
    ["too-short password", { password: "Ab1", confirmPassword: "Ab1" }, "password"],
    ["no uppercase", { password: "alllowercase12345", confirmPassword: "alllowercase12345" }, "password"],
    ["no lowercase", { password: "ALLUPPERCASE12345", confirmPassword: "ALLUPPERCASE12345" }, "password"],
    ["no digit", { password: "NoDigitsInThisOne", confirmPassword: "NoDigitsInThisOne" }, "password"],
    ["common password", { password: "Password12345", confirmPassword: "Password12345" }, "password"],
    ["password contains the email name", { password: "Asha.verma-Is-Me-1", confirmPassword: "Asha.verma-Is-Me-1" }, "password"],
    ["over-long password", { password: `Aa1${"x".repeat(200)}`, confirmPassword: `Aa1${"x".repeat(200)}` }, "password"],
    ["confirmation mismatch", { confirmPassword: `${GOOD_PASSWORD}x` }, "confirmPassword"]
  ])("rejects %s with a 400 and creates nothing", async (_label, overrides, field) => {
    const before = await userCount();
    const response = await register(valid(overrides));
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(response.body).error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(response.body.error.details)).toContain(`"path":"${field}"`);
    // Submitted values are never echoed back.
    expect(JSON.stringify(response.body)).not.toContain(GOOD_PASSWORD);
    expect(await userCount()).toBe(before);
  });

  it("rejects a non-object body", async () => {
    expect((await register("just a string")).status).toBe(400);
    expect((await register([])).status).toBe(400);
  });
});

describe("POST /auth/register: privilege fields", () => {
  it.each([
    [{ role: "ADMIN" }],
    [{ role: "AUTHOR" }],
    [{ isAdmin: true }],
    [{ userId: "cmv96neob0000ll0vc45sncze" }],
    [{ authorProfile: { externalAuthorId: "SYN-A001" } }],
    [{ passwordHash: "$argon2id$v=19$m=1,t=1,p=1$x$y" }]
  ])("rejects extra field %j and never creates an account", async (extra) => {
    const before = await userCount();
    const response = await register(valid(extra));
    expect(response.status).toBe(400);
    expect(await userCount()).toBe(before);
    expect(await prisma.user.count({ where: { email: "asha.verma@writers.test" } })).toBe(0);
  });

  it("never yields an ADMIN, however the request is shaped", async () => {
    await register(valid({ role: "ADMIN" }));
    await register({ ...valid(), "role ": "ADMIN" });
    await register({ ...valid(), __proto__: { role: "ADMIN" }, constructor: { role: "ADMIN" } });
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
    expect(admins.map((a) => a.email)).toEqual([ADMIN_EMAIL]);
  });

  it("an account created through the public API has no admin access", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/register").set("Origin", WEB_ORIGIN).send(valid());
    expect((await agent.get("/api/v1/admin/tickets")).status).toBe(403);
    expect((await agent.get("/api/v1/admin/tickets/anything")).status).toBe(403);
  });
});

describe("POST /auth/register: duplicates and races", () => {
  it("answers 409 with a generic message for an existing email, in any casing, and changes nothing", async () => {
    const existing = loadSyntheticDataset()[0]!.email;
    const before = await userCount();
    const hash = (await prisma.user.findUniqueOrThrow({ where: { email: existing } })).passwordHash;
    for (const email of [existing, existing.toUpperCase(), ` ${existing} `]) {
      const response = await register(valid({ email }));
      expect(response.status).toBe(409);
      expect(apiErrorSchema.parse(response.body).error.code).toBe("CONFLICT");
      expect(JSON.stringify(response.body)).not.toMatch(/exists|taken|registered/i);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    expect(await userCount()).toBe(before);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: existing } })).passwordHash).toBe(hash);
  });

  it("cannot take over the admin email", async () => {
    const response = await register(valid({ email: ADMIN_EMAIL }));
    expect(response.status).toBe(409);
    const adminLogin = await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: ADMIN_EMAIL, password: GOOD_PASSWORD });
    expect(adminLogin.status).toBe(401);
  });

  it("lets exactly one of many concurrent registrations for the same email win", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => register(valid())));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(statuses.some((s) => s >= 500)).toBe(false);
    expect(await prisma.user.count({ where: { email: "asha.verma@writers.test" } })).toBe(1);
    expect(await prisma.authorProfile.count({ where: { user: { email: "asha.verma@writers.test" } } })).toBe(1);
  });

  it("allows concurrent registrations for different emails", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => register(valid({ email: `writer${i}@writers.test`, name: `Writer ${i}` }))));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const ids = new Set(results.map((r) => r.body.user.authorProfile.externalAuthorId));
    expect(ids.size).toBe(6);
  });
});

describe("POST /auth/register: request guards", () => {
  it("rejects a foreign Origin and a cross-site fetch without creating an account", async () => {
    const before = await userCount();
    expect((await register(valid(), app, "https://evil.example")).status).toBe(403);
    const crossSite = await request(app).post("/api/v1/auth/register").set("Sec-Fetch-Site", "cross-site").send(valid());
    expect(crossSite.status).toBe(403);
    expect(await userCount()).toBe(before);
  });

  it("refuses to register while already signed in", async () => {
    const author = await login(app, config, loadSyntheticDataset()[0]!.email);
    const response = await mutate(author, "post", "/api/v1/auth/register").send(valid());
    expect(response.status).toBe(403);
    expect(await prisma.user.count({ where: { email: "asha.verma@writers.test" } })).toBe(0);
  });

  it("rate-limits per IP, counting invalid attempts too, with Retry-After", async () => {
    const limited = createTestApp(prisma, { REGISTER_LIMIT_PER_IP_PER_HOUR: "3", REGISTER_LIMIT_GLOBAL_PER_HOUR: "1000" }).app;
    expect((await register(valid({ email: "a1@writers.test" }), limited)).status).toBe(201);
    expect((await register(valid({ email: "bad" }), limited)).status).toBe(400);
    expect((await register(valid({ email: "a2@writers.test" }), limited)).status).toBe(201);
    const blocked = await register(valid({ email: "a3@writers.test" }), limited);
    expect(blocked.status).toBe(429);
    expect(apiErrorSchema.parse(blocked.body).error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(await prisma.user.count({ where: { email: "a3@writers.test" } })).toBe(0);
  });

  it("applies a global ceiling across clients", async () => {
    const limited = createTestApp(prisma, { REGISTER_LIMIT_PER_IP_PER_HOUR: "100", REGISTER_LIMIT_GLOBAL_PER_HOUR: "2" }).app;
    expect((await register(valid({ email: "g1@writers.test" }), limited)).status).toBe(201);
    expect((await register(valid({ email: "g2@writers.test" }), limited)).status).toBe(201);
    expect((await register(valid({ email: "g3@writers.test" }), limited)).status).toBe(429);
  });

  it("does not let registration attempts consume the login allowance", async () => {
    const limited = createTestApp(prisma, { REGISTER_LIMIT_PER_IP_PER_HOUR: "1", LOGIN_MAX_FAILURES: "3" }).app;
    await register(valid({ email: "x1@writers.test" }), limited);
    expect((await register(valid({ email: "x2@writers.test" }), limited)).status).toBe(429);
    const ok = await request(limited).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: ADMIN_EMAIL, password: TEST_PASSWORD });
    expect(ok.status).toBe(200);
  });
});

describe("a freshly registered author", () => {
  it("starts with an empty workspace and cannot see anyone else's records", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/register").set("Origin", WEB_ORIGIN).send(valid());
    const books = await agent.get("/api/v1/author/books");
    expect(books.status).toBe(200);
    expect(books.body.items).toEqual([]);
    expect(books.body.total).toBe(0);
    const tickets = await agent.get("/api/v1/author/tickets");
    expect(tickets.status).toBe(200);
    expect(tickets.body.items).toEqual([]);
    expect(tickets.body.total).toBe(0);

    const someoneElses = await prisma.ticket.findFirst();
    const someoneElsesBook = await prisma.book.findFirstOrThrow();
    if (someoneElses) expect((await agent.get(`/api/v1/author/tickets/${someoneElses.id}`)).status).toBe(404);
    expect((await agent.get(`/api/v1/author/books/${someoneElsesBook.id}`)).status).toBe(404);
  });

  it("can create a general ticket without a book and then see exactly that ticket", async () => {
    const agent = request.agent(app);
    const response = await agent.post("/api/v1/auth/register").set("Origin", WEB_ORIGIN).send(valid());
    const csrf = cookieValue(response.headers["set-cookie"], config.csrfCookieName)!;
    const created = await agent.post("/api/v1/author/tickets").set("Origin", WEB_ORIGIN).set("X-CSRF-Token", csrf)
      .send({ bookId: null, subject: "How do I add my first book?", description: "I just created my account and have no books yet." });
    expect(created.status).toBe(201);
    expect(created.body.ticket).toMatchObject({ status: "OPEN", bookId: null });
    const list = await agent.get("/api/v1/author/tickets");
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(created.body.ticket.id);
    const profile = await prisma.authorProfile.findFirstOrThrow({ where: { user: { email: "asha.verma@writers.test" } } });
    expect(created.body.ticket.authorId).toBe(profile.id);
  });

  it("cannot attach a ticket to another author's book", async () => {
    const agent = request.agent(app);
    const response = await agent.post("/api/v1/auth/register").set("Origin", WEB_ORIGIN).send(valid());
    const csrf = cookieValue(response.headers["set-cookie"], config.csrfCookieName)!;
    const book = await prisma.book.findFirstOrThrow();
    const created = await agent.post("/api/v1/author/tickets").set("Origin", WEB_ORIGIN).set("X-CSRF-Token", csrf)
      .send({ bookId: book.id, subject: "Not my book", description: "Trying to attach to another author's book." });
    expect(created.status).toBeGreaterThanOrEqual(400);
    expect(created.status).toBeLessThan(500);
    expect(await prisma.ticket.count({ where: { subject: "Not my book" } })).toBe(0);
  });
});

describe("regression: existing accounts", () => {
  it("the seeded admin still signs in and keeps admin access", async () => {
    const admin = await login(app, config, ADMIN_EMAIL);
    expect(admin.response.body.user).toMatchObject({ role: "ADMIN", authorProfile: null });
    expect((await admin.agent.get("/api/v1/admin/tickets")).status).toBe(200);
  });

  it("seeded authors still sign in and are denied admin routes", async () => {
    const author = await login(app, config, loadSyntheticDataset()[0]!.email);
    expect((await author.agent.get("/api/v1/admin/tickets")).status).toBe(403);
  });
});
