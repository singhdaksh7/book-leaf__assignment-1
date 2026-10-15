import { readFileSync } from "node:fs";
import { PrismaClient } from "@bookleaf/db";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { authorEmail, loginViaUi, logoutViaUi, mockAiRequests, runtime } from "./helpers";

/**
 * One continuous author <-> admin journey on a seeded synthetic database. Tests run in order and share the ticket created in
 * step 3, so this file is serial. Everything is synthetic; the AI provider is a local mock (no network, no cost).
 */
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const subject = `E2E royalty question ${stamp}`;
const description = "I published my book 4 months ago and still haven't received any royalty. What's going on?";
const attachmentName = "royalty-statement.txt";
const attachmentText = "Synthetic statement line 1\nSynthetic statement line 2\n";
const authorReply = `Author follow-up ${stamp}: please confirm the payout schedule.`;
const internalNote = `INTERNAL-ONLY note ${stamp}: check ledger before replying`;

let ticketId = "";
let authorCtx: BrowserContext;
let adminCtx: BrowserContext;
let author: Page;
let admin: Page;
let prisma: PrismaClient;

test.beforeAll(async ({ browser }) => {
  prisma = new PrismaClient({ datasourceUrl: runtime().databaseUrl });
  authorCtx = await browser.newContext();
  adminCtx = await browser.newContext();
  author = await authorCtx.newPage();
  admin = await adminCtx.newPage();
});
test.afterAll(async () => {
  await authorCtx?.close();
  await adminCtx?.close();
  await prisma?.$disconnect();
});

test("1. author login (a wrong password is rejected first)", async () => {
  const rt = runtime();
  await loginViaUi(author, authorEmail(1), "definitely-wrong-password");
  await expect(author.getByRole("alert")).toBeVisible();
  await expect(author).toHaveURL(/\/login/);

  await loginViaUi(author, authorEmail(1), rt.authorPassword);
  await expect(author).toHaveURL(/\/dashboard$/);
});

test("2. author book catalogue shows only the author's own books", async () => {
  await author.goto("/books");
  await expect(author.getByRole("heading", { name: "My Books" })).toBeVisible();
  await expect(author.getByRole("link", { name: "Synthetic Book 1" }).first()).toBeVisible();
  await expect(author.getByRole("link", { name: "Synthetic Book 2" }).first()).toBeVisible();
  await expect(author.getByText("Synthetic Book 3")).toHaveCount(0); // belongs to author 2
  await author.getByRole("link", { name: "Synthetic Book 1" }).first().click();
  await expect(author.getByRole("heading", { name: "Synthetic Book 1" })).toBeVisible();
});

test("3. author creates a ticket with an attachment", async () => {
  await author.goto("/tickets/new");
  const option = author.locator("#ticket-book option", { hasText: "Synthetic Book 1" });
  await expect(option).toHaveCount(1);
  await author.locator("#ticket-book").selectOption((await option.getAttribute("value"))!);
  await author.getByLabel("Subject Summary").fill(subject);
  await author.getByLabel("Detailed Description").fill(description);
  await author.locator('input[type="file"]').setInputFiles({ name: attachmentName, mimeType: "text/plain", buffer: Buffer.from(attachmentText) });
  await expect(author.getByText(attachmentName)).toBeVisible();
  await author.getByRole("button", { name: "Submit Ticket" }).click();

  await expect(author).toHaveURL(/\/tickets\/(?!new$)[^/?#]+$/);
  ticketId = author.url().split("/").pop()!;
  await expect(author.getByRole("heading", { name: subject })).toBeVisible();
  await expect(author.getByText(attachmentName).first()).toBeVisible();
});

test("4. author downloads the attachment byte-for-byte", async () => {
  const downloadPromise = author.waitForEvent("download");
  await author.getByRole("button", { name: `Download ${attachmentName}` }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(attachmentName);
  expect(readFileSync((await download.path())!, "utf8")).toBe(attachmentText);
});

test("5. author reply persists across reload", async () => {
  await author.getByPlaceholder("Type your reply to BookLeaf support...").fill(authorReply);
  await author.getByRole("button", { name: "Send Reply" }).click();
  await expect(author.getByText(authorReply)).toBeVisible();
  await author.reload();
  await expect(author.getByText(authorReply)).toBeVisible();
});

test("6. admin signs in and manages the ticket (assign, status)", async () => {
  const rt = runtime();
  await loginViaUi(admin, rt.adminEmail, rt.adminPassword);
  await expect(admin).toHaveURL(/\/admin\/dashboard$/);

  await admin.goto("/admin/queue");
  await expect(admin.getByRole("link", { name: subject })).toBeVisible();
  await admin.getByRole("link", { name: subject }).click();
  await expect(admin).toHaveURL(new RegExp(`/admin/tickets/${ticketId}$`));
  await expect(admin.getByText(authorReply)).toBeVisible(); // the author's reply is visible to staff

  const statusSelect = admin.getByText("Ticket Status").locator("xpath=following::select[1]");
  await admin.getByRole("button", { name: "Assign to Me" }).click();
  await expect(admin.getByText("Assigned to You")).toBeVisible();
  await statusSelect.selectOption("IN_PROGRESS");
  await admin.getByRole("button", { name: /Apply Overrides/ }).click();
  await expect(admin.getByRole("button", { name: /Apply Overrides/ })).toBeEnabled();
  await admin.reload();
  await expect(admin.getByText("Assigned to You")).toBeVisible();
  await expect(statusSelect).toHaveValue("IN_PROGRESS");

  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  expect(ticket.status).toBe("IN_PROGRESS");
  expect(ticket.assigneeId).not.toBeNull();
});

test("7. internal notes stay private to staff", async () => {
  await admin.getByPlaceholder("Add private note for editorial or accounting team...").fill(internalNote);
  await admin.getByRole("button", { name: "Save Internal Note" }).click();
  await expect(admin.getByText(internalNote)).toBeVisible();
  await admin.reload();
  await expect(admin.getByText(internalNote)).toBeVisible();

  await author.reload();
  await expect(author.getByRole("heading", { name: subject })).toBeVisible();
  await expect(author.getByText(internalNote)).toHaveCount(0);

  // ...and not in the author's API payload either.
  const rt = runtime();
  const payload = await author.request.get(`${rt.apiOrigin}/api/v1/author/tickets/${ticketId}`);
  expect(payload.status()).toBe(200);
  expect(await payload.text()).not.toContain("INTERNAL-ONLY");
  expect((await author.request.get(`${rt.apiOrigin}/api/v1/admin/tickets/${ticketId}`)).status()).toBe(403);
});

test("8. AI draft is reviewed by an admin (mocked provider) and never auto-sent", async () => {
  // Analysis runs in the background after ticket creation; reload until the COMPLETED card appears.
  await expect(async () => {
    await admin.reload();
    await expect(admin.getByRole("button", { name: "Insert Draft into Reply Box" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(admin.getByText("Human Review Required")).toBeVisible();
  await expect(admin.getByText("kb.royalty-policy").first()).toBeVisible();

  const authorUser = await prisma.user.findUniqueOrThrow({ where: { email: authorEmail(1) } });
  const staffMessages = await prisma.ticketMessage.count({ where: { ticketId, authorId: { not: authorUser.id } } });
  expect(staffMessages, "AI must not send anything on its own").toBe(0);

  await admin.getByRole("button", { name: "Insert Draft into Reply Box" }).click();
  const box = admin.getByPlaceholder(/Compose reply to author/);
  await expect(box).toHaveValue(/Dear Synthetic/);
  await expect(box).toHaveValue(/verify the royalty figures/);
  await expect(box).not.toHaveValue(/\{\{/);
});

test("9. admin reply is visible to the author", async () => {
  await admin.getByRole("button", { name: "Send Reply" }).click();
  await expect(admin.getByText("BookLeaf Staff Reply")).toBeVisible();

  await author.reload();
  await expect(author.getByText("BookLeaf Editorial Support")).toBeVisible();
  await expect(author.getByText(/verify the royalty figures/)).toBeVisible();
  await expect(author.getByText(internalNote)).toHaveCount(0);
});

test("9b. nothing identifying or financial was sent to the AI provider", async () => {
  const requests = await mockAiRequests(author.request);
  expect(requests.length).toBeGreaterThanOrEqual(2); // classify + draft
  expect(requests.every((r) => r.authorization === "Bearer sk-or-e2e-0000000000000000")).toBe(true);
  const outbound = JSON.stringify(requests.map((r) => r.body.messages));
  // The ticket text itself is sent (digit runs are masked by the AI package), nothing else about the author.
  expect(outbound).toContain("E2E royalty question [number]");
  expect(outbound).toContain("still haven't received any royalty");
  for (const secret of [authorEmail(1), "+00-000-000-1001", "Samplepur", "000-0-00000-001-0", "Synthetic Author 1", internalNote]) {
    expect(outbound, `must not contain ${secret}`).not.toContain(secret);
  }
  expect(outbound).not.toMatch(/royalty_?(pending|paid)|total_?royalty|"?mrp"?\s*:|copies_?sold|totalCopiesSold|lastRoyaltyPayout|password/i);
});

test("10. session expiry ends the session server-side and in the UI", async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: authorEmail(1) } });
  const expired = await prisma.session.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 2 * 3_600_000), expiresAt: new Date(Date.now() - 60_000) } }); // the DB requires expiresAt > createdAt
  expect(expired.count).toBeGreaterThan(0);

  const rt = runtime();
  expect((await author.request.get(`${rt.apiOrigin}/api/v1/auth/me`)).status()).toBe(401);
  await author.reload();
  await expect(author).toHaveURL(/\/login/);
  await author.goto("/tickets");
  await expect(author).toHaveURL(/\/login/);
});

test("10b. logout revokes the session: a replayed cookie no longer works", async ({ browser }) => {
  const rt = runtime();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginViaUi(page, authorEmail(2), rt.authorPassword);
  await expect(page).toHaveURL(/\/dashboard$/);
  const session = (await ctx.cookies()).filter((c) => c.name === "bookleaf_session");
  expect(session).toHaveLength(1);
  expect(session[0]!.httpOnly).toBe(true);
  expect(session[0]!.sameSite).toBe("Lax");

  await logoutViaUi(page);
  const replay = await browser.newContext();
  await replay.addCookies(session);
  expect((await replay.request.get(`${rt.apiOrigin}/api/v1/auth/me`)).status()).toBe(401);
  await replay.close();
  await ctx.close();
});
