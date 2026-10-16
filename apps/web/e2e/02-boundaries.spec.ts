import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { apiLogin, authorEmail, loginViaUi, mutateHeaders, runtime, type ApiSession } from "./helpers";

/** Authentication, authorization, CSRF and attachment-security boundaries, exercised against the real running stack. */

const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
let rt: ReturnType<typeof runtime>;
const contexts: APIRequestContext[] = [];

async function session(email: string, password: string): Promise<ApiSession> {
  const ctx = await pwRequest.newContext();
  contexts.push(ctx);
  return apiLogin(ctx, email, password);
}

test.beforeAll(() => {
  rt = runtime();
});
test.afterAll(async () => {
  await Promise.all(contexts.map((c) => c.dispose()));
});

async function createTicket(s: ApiSession, subject: string): Promise<string> {
  const res = await s.request.post(`${rt.apiOrigin}/api/v1/author/tickets`, { headers: mutateHeaders(s), data: { bookId: null, subject, description: "Boundary test ticket for synthetic data." } });
  expect(res.status()).toBe(201);
  return (await res.json()).ticket.id as string;
}

test.describe("authentication", () => {
  test("anonymous API calls are rejected", async () => {
    const anon = await pwRequest.newContext();
    contexts.push(anon);
    for (const path of ["/auth/me", "/author/tickets", "/author/books", "/admin/tickets"]) {
      expect((await anon.get(`${rt.apiOrigin}/api/v1${path}`)).status(), path).toBe(401);
    }
    expect((await anon.get(`${rt.apiOrigin}/api/v1/events`)).status()).toBeGreaterThanOrEqual(401);
  });

  test("anonymous browser visits to protected pages are sent to the login page", async ({ page }) => {
    for (const path of ["/dashboard", "/tickets", "/books", "/admin/queue"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("the session cookie is HttpOnly and the CSRF cookie is script-readable", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginViaUi(page, authorEmail(3), rt.authorPassword);
    await expect(page).toHaveURL(/\/dashboard$/);
    const cookies = await ctx.cookies();
    expect(cookies.find((c) => c.name === "bookleaf_session")).toMatchObject({ httpOnly: true, sameSite: "Lax" });
    expect(cookies.find((c) => c.name === "XSRF-TOKEN")?.httpOnly).toBe(false);
    expect(await page.evaluate(() => document.cookie)).not.toContain("bookleaf_session");
    await ctx.close();
  });
});

test.describe("authorization", () => {
  test("an author cannot reach the admin console (UI) or admin API", async ({ page }) => {
    await loginViaUi(page, authorEmail(4), rt.authorPassword);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/admin/queue");
    await expect(page.getByRole("heading", { name: "Access Restricted" })).toBeVisible();
    await expect(page.getByText("Internal Staff Notes")).toHaveCount(0);
    await page.goto("/admin/dashboard");
    await expect(page.getByRole("heading", { name: "Access Restricted" })).toBeVisible();

    const author = await session(authorEmail(4), rt.authorPassword);
    for (const path of ["/admin/tickets", "/admin/tickets/anything"]) {
      expect((await author.request.get(`${rt.apiOrigin}/api/v1${path}`)).status(), path).toBe(403);
    }
  });

  test("an author cannot read or write another author's ticket or attachments", async () => {
    const owner = await session(authorEmail(5), rt.authorPassword);
    const intruder = await session(authorEmail(6), rt.authorPassword);
    const ticketId = await createTicket(owner, "Owner-only ticket");

    const upload = await owner.request.post(`${rt.apiOrigin}/api/v1/author/tickets/${ticketId}/attachments?filename=secret.png`, { headers: { ...mutateHeaders(owner), "Content-Type": "image/png" }, data: png });
    expect(upload.status()).toBe(201);
    const attachmentId = (await upload.json()).attachment.id as string;

    const base = `${rt.apiOrigin}/api/v1/author/tickets/${ticketId}`;
    expect((await intruder.request.get(base)).status()).toBe(404);
    expect((await intruder.request.get(`${base}/attachments`)).status()).toBe(404);
    expect((await intruder.request.get(`${base}/attachments/${attachmentId}`)).status()).toBe(404);
    expect((await intruder.request.post(`${base}/messages`, { headers: mutateHeaders(intruder), data: { body: "hello" } })).status()).toBe(404);
    expect((await intruder.request.post(`${base}/attachments?filename=x.png`, { headers: { ...mutateHeaders(intruder), "Content-Type": "image/png" }, data: png })).status()).toBe(404);
    // The intruder's list never includes it.
    const list = await (await intruder.request.get(`${rt.apiOrigin}/api/v1/author/tickets`)).json();
    expect(JSON.stringify(list)).not.toContain(ticketId);
  });

  test("admin-only data never appears in author responses", async () => {
    const author = await session(authorEmail(7), rt.authorPassword);
    const ticketId = await createTicket(author, "Privacy shape check");
    const body = JSON.stringify(await (await author.request.get(`${rt.apiOrigin}/api/v1/author/tickets/${ticketId}`)).json());
    expect(body).not.toMatch(/internalNote|aiAnalysis|draftResponse|auditLog|passwordHash|storageKey|sha256/i);
  });
});

test.describe("CSRF and origin", () => {
  test("mutations without the CSRF token are refused", async () => {
    const author = await session(authorEmail(8), rt.authorPassword);
    const noToken = await author.request.post(`${rt.apiOrigin}/api/v1/author/tickets`, { headers: { Origin: rt.webOrigin }, data: { bookId: null, subject: "no csrf", description: "no csrf token supplied here" } });
    expect(noToken.status()).toBe(403);
    const wrongToken = await author.request.post(`${rt.apiOrigin}/api/v1/author/tickets`, { headers: { Origin: rt.webOrigin, "X-CSRF-Token": "not-the-token" }, data: { bookId: null, subject: "bad csrf", description: "wrong csrf token supplied" } });
    expect(wrongToken.status()).toBe(403);
  });

  test("mutations from a foreign origin are refused even with a valid token", async () => {
    const author = await session(authorEmail(8), rt.authorPassword);
    const res = await author.request.post(`${rt.apiOrigin}/api/v1/author/tickets`, { headers: { Origin: "http://evil.example.test", "X-CSRF-Token": author.csrf }, data: { bookId: null, subject: "evil origin", description: "request from another origin" } });
    expect(res.status()).toBe(403);
  });

  test("login from a foreign origin is refused (login CSRF)", async () => {
    const ctx = await pwRequest.newContext();
    contexts.push(ctx);
    const res = await ctx.post(`${rt.apiOrigin}/api/v1/auth/login`, { headers: { Origin: "http://evil.example.test" }, data: { email: authorEmail(8), password: rt.authorPassword } });
    expect(res.status()).toBe(403);
  });

  test("CORS only allows the configured web origin", async () => {
    const ctx = await pwRequest.newContext();
    contexts.push(ctx);
    const allowed = await ctx.fetch(`${rt.apiOrigin}/api/v1/auth/me`, { headers: { Origin: rt.webOrigin } });
    expect(allowed.headers()["access-control-allow-origin"]).toBe(rt.webOrigin);
    expect(allowed.headers()["access-control-allow-credentials"]).toBe("true");
    const foreign = await ctx.fetch(`${rt.apiOrigin}/api/v1/auth/me`, { headers: { Origin: "http://evil.example.test" } });
    // The cors package answers with the single configured origin; browsers then block the foreign page. It must never echo "*" or the foreign origin.
    expect(foreign.headers()["access-control-allow-origin"]).toBe(rt.webOrigin);
  });
});

test.describe("attachment security", () => {
  test("content must match the declared type; unsupported types are refused", async () => {
    const author = await session(authorEmail(9), rt.authorPassword);
    const ticketId = await createTicket(author, "Attachment validation");
    const url = (name: string) => `${rt.apiOrigin}/api/v1/author/tickets/${ticketId}/attachments?filename=${encodeURIComponent(name)}`;
    const send = (name: string, type: string, data: Buffer | string) => author.request.post(url(name), { headers: { ...mutateHeaders(author), "Content-Type": type }, data });

    expect((await send("evil.png", "image/png", "<html><script>alert(1)</script></html>")).status()).toBe(400);
    expect((await send("run.html", "text/html", "<html></html>")).status()).toBeGreaterThanOrEqual(400);
    expect((await send("run.exe", "application/octet-stream", Buffer.from("MZ"))).status()).toBeGreaterThanOrEqual(400);
    expect((await send("binary.txt", "text/plain", Buffer.from([0x41, 0x00, 0x42]))).status()).toBe(400);
    expect((await send("ok.png", "image/png", png)).status()).toBe(201);
  });

  test("oversized uploads are refused", async () => {
    const author = await session(authorEmail(9), rt.authorPassword);
    const ticketId = await createTicket(author, "Attachment size");
    const res = await author.request.post(`${rt.apiOrigin}/api/v1/author/tickets/${ticketId}/attachments?filename=big.txt`, { headers: { ...mutateHeaders(author), "Content-Type": "text/plain" }, data: Buffer.alloc(5 * 1024 * 1024 + 1, 97) });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("downloads are forced to attachments, never sniffed, and traversal names are neutralised", async () => {
    const author = await session(authorEmail(9), rt.authorPassword);
    const ticketId = await createTicket(author, "Attachment download headers");
    const up = await author.request.post(`${rt.apiOrigin}/api/v1/author/tickets/${ticketId}/attachments?filename=${encodeURIComponent("../../etc/passwd.txt")}`, { headers: { ...mutateHeaders(author), "Content-Type": "text/plain" }, data: "plain synthetic text" });
    expect(up.status()).toBe(201);
    const meta = (await up.json()).attachment;
    expect(meta.fileName).not.toMatch(/[\\/]/);

    const download = await author.request.get(`${rt.apiOrigin}/api/v1/author/tickets/${ticketId}/attachments/${meta.id}`);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toMatch(/^attachment;/);
    expect(download.headers()["x-content-type-options"]).toBe("nosniff");
    expect(await download.text()).toBe("plain synthetic text");
  });
});

test.describe("security headers", () => {
  test("API responses carry hardening headers and no framework banner", async () => {
    const ctx = await pwRequest.newContext();
    contexts.push(ctx);
    const res = await ctx.get(`${rt.apiOrigin}/healthz`);
    const h = res.headers();
    expect(h["x-powered-by"]).toBeUndefined();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-request-id"]).toBeTruthy();
    const authed = await ctx.get(`${rt.apiOrigin}/api/v1/auth/me`);
    expect(authed.headers()["cache-control"]).toBe("no-store");
  });
});
