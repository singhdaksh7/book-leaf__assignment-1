import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import request from "supertest";
import { PrismaClient } from "@bookleaf/db";
import { hashPassword } from "@bookleaf/db/password";
import { importSeedData, parseSeedDataset } from "@bookleaf/db/seed";
import { createApp, type AppDependencies } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
export const syntheticSeedPath = resolve(here, "..", "..", "..", "data", "synthetic_seed.json");

export const TEST_PASSWORD = "correct horse battery staple";
export const ADMIN_EMAIL = "admin@example.test";
export const WEB_ORIGIN = "http://localhost:5173";

/** Cheap Argon2 for tests only; production uses the defaults in @bookleaf/db/password. */
export const fastHash = (password: string) => hashPassword(password, { memoryCost: 1024, timeCost: 2 });

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: "test", DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://unused", SESSION_SECRET: "test-secret-test-secret-test-secret-0123456789",
    WEB_ORIGIN, ...overrides
  });
}

export function createTestApp(prisma: PrismaClient, overrides: Record<string, string> = {}, extra: Partial<AppDependencies> = {}): { app: Express; config: AppConfig } {
  const config = testConfig(overrides);
  return { app: createApp({ config, prisma, dummyHashCost: { memoryCost: 1024, timeCost: 2 }, ...extra }), config };
}

const tables = ["AuditLog", "AiAnalysis", "TicketAttachment", "TicketAssignment", "InternalNote", "TicketMessage", "Ticket", "Session", "Book", "AuthorProfile", "User"];
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export function loadSyntheticDataset() {
  return parseSeedDataset(JSON.parse(readFileSync(syntheticSeedPath, "utf8")));
}

export async function seedSynthetic(prisma: PrismaClient) {
  const dataset = loadSyntheticDataset();
  const summary = await importSeedData(prisma, dataset, {
    credentials: { authorPassword: TEST_PASSWORD, adminEmail: ADMIN_EMAIL, adminPassword: TEST_PASSWORD }, hash: fastHash
  });
  return { dataset, summary };
}

export function cookieValue(setCookie: string[] | string | undefined, name: string): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const line = list.find((entry) => entry.startsWith(`${name}=`));
  return line ? decodeURIComponent(line.slice(name.length + 1).split(";")[0] ?? "") : undefined;
}

export function rawCookie(setCookie: string[] | string | undefined, name: string): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.find((entry) => entry.startsWith(`${name}=`));
}

/** A logged-in client: cookies are sent automatically; mutating calls add the CSRF header. */
export async function login(app: Express, config: AppConfig, email: string, password = TEST_PASSWORD) {
  const agent = request.agent(app);
  const response = await agent.post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email, password });
  if (response.status !== 200) throw new Error(`login failed with ${response.status}`);
  const csrf = cookieValue(response.headers["set-cookie"], config.csrfCookieName) as string;
  return { agent, csrf, response };
}

export type Client = Awaited<ReturnType<typeof login>>;

/** Mutating request with the Origin and CSRF header a browser client would send. */
export const mutate = (client: Client, method: "post" | "patch" | "put" | "delete", url: string) =>
  client.agent[method](url).set("Origin", WEB_ORIGIN).set("X-CSRF-Token", client.csrf);

export async function makeTicket(prisma: PrismaClient, authorId: string, data: Partial<Parameters<PrismaClient["ticket"]["create"]>[0]["data"]> = {}) {
  return prisma.ticket.create({ data: { authorId, subject: "Synthetic subject", description: "Synthetic description text", ...data } as never });
}

export async function profileFor(prisma: PrismaClient, externalAuthorId: string) {
  return prisma.authorProfile.findUniqueOrThrow({ where: { externalAuthorId } });
}
