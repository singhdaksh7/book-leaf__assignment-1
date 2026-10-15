import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));

export interface Runtime {
  databaseUrl: string;
  mockUrl: string;
  apiOrigin: string;
  webOrigin: string;
  attachmentDir: string;
  authorPassword: string;
  adminEmail: string;
  adminPassword: string;
}

/** Written by e2e/stack.mjs once the disposable stack is up. */
export function runtime(): Runtime {
  return JSON.parse(readFileSync(resolve(here, "..", "..", "..", "node_modules", ".cache", "bookleaf-e2e", "runtime.json"), "utf8")) as Runtime;
}

export const authorEmail = (n: number) => `synthetic.author${n}@example.test`;

export async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Author Email Address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /Sign In to Portal/ }).click();
}

export async function logoutViaUi(page: Page): Promise<void> {
  await page.getByTitle("Sign out of portal").click();
  await expect(page).toHaveURL(/\/login$/);
}

export interface ApiSession {
  request: APIRequestContext;
  csrf: string;
}

/** Programmatic login (the cookie jar lives in the APIRequestContext). Mirrors what the browser does. */
export async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<ApiSession> {
  const rt = runtime();
  const res = await request.post(`${rt.apiOrigin}/api/v1/auth/login`, { data: { email, password }, headers: { Origin: rt.webOrigin } });
  expect(res.status(), "login status").toBe(200);
  const state = await request.storageState();
  const csrf = state.cookies.find((c) => c.name === "XSRF-TOKEN")?.value;
  expect(csrf, "csrf cookie issued").toBeTruthy();
  return { request, csrf: csrf! };
}

export function mutateHeaders(session: ApiSession): Record<string, string> {
  return { Origin: runtime().webOrigin, "X-CSRF-Token": session.csrf };
}

export interface MockAiRequest {
  authorization: string | null;
  body: { messages: Array<{ role: string; content: string }> };
}

export async function mockAiRequests(request: APIRequestContext): Promise<MockAiRequest[]> {
  return (await request.get(`${runtime().mockUrl}/__control/requests`)).json();
}
