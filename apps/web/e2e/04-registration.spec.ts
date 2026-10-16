import { PrismaClient } from "@bookleaf/db";
import { expect, test, type Page } from "@playwright/test";
import { apiLogin, authorEmail, loginViaUi, logoutViaUi, runtime } from "./helpers";

/**
 * Public author self-registration, end to end in a real browser against the disposable stack. Independent of the journey in
 * 01..03 (it only needs the seeded database), so it runs last. All identities are synthetic and unique per run.
 */
const stamp = Date.now();
const PASSWORD = "Sturdy-Pass-2026";
let prisma: PrismaClient;

test.beforeAll(() => {
  prisma = new PrismaClient({ datasourceUrl: runtime().databaseUrl });
});
test.afterAll(async () => {
  await prisma?.$disconnect();
});

async function fillRegistration(page: Page, email: string, name = "Asha Verma", password = PASSWORD, confirm = password) {
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.locator("#register-password").fill(password);
  await page.locator("#register-confirm").fill(confirm);
}

test.describe("desktop", () => {
  test.describe.configure({ mode: "serial" });
  const email = `new.author.${stamp}@example.test`;

  test("1. login page links to registration and back", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole("heading", { name: "Create your author account" })).toBeVisible();
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("2. validation errors are specific and nothing is created", async ({ page }) => {
    const users = await prisma.user.count();
    await page.goto("/register");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter your full name.")).toBeVisible();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(page.getByLabel("Full name")).toBeFocused();

    await fillRegistration(page, "not-an-email", "Asha Verma", "short", "different");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
    await expect(page.getByText("Passwords do not match.")).toBeVisible();
    expect(await prisma.user.count()).toBe(users);
  });

  test("3. show/hide password works and the password never appears in the URL", async ({ page }) => {
    await page.goto("/register");
    await page.locator("#register-password").fill(PASSWORD);
    await expect(page.locator("#register-password")).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await expect(page.locator("#register-password")).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(page.locator("#register-password")).toHaveAttribute("type", "password");
    expect(page.url()).not.toContain(PASSWORD);
  });

  test("4. registers, lands on a clean dashboard, files a ticket, signs out and back in", async ({ page }) => {
    await page.goto("/register");
    await fillRegistration(page, email);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Account created")).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 });

    // Role and profile are decided by the server.
    const row = await prisma.user.findUniqueOrThrow({ where: { email }, include: { authorProfile: true } });
    expect(row.role).toBe("AUTHOR");
    expect(row.authorProfile?.externalAuthorId).toMatch(/^WEB-/);

    // Clean workspace: no inherited books or tickets, no demo labels.
    await expect(page.getByText("No books are linked to your account yet").first()).toBeVisible();
    await expect(page.getByText("No tickets filed yet")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Synthetic Book|DEMO MOCK|DEMO DRAFT/);
    await page.goto("/books");
    await expect(page.getByText("No books found")).toBeVisible();
    await page.goto("/tickets");
    await expect(page.getByText("No support tickets found")).toBeVisible();

    // Author ticket creation right after registration (no book yet).
    await page.goto("/tickets/new");
    await page.getByLabel("Subject Summary").fill(`First question ${stamp}`);
    await page.getByLabel("Detailed Description").fill("I have just created my account and want to know how to add my book.");
    await page.getByRole("button", { name: "Submit Ticket" }).click();
    await expect(page).toHaveURL(/\/tickets\/(?!new$)[^/?#]+$/);
    await expect(page.getByRole("heading", { name: `First question ${stamp}` })).toBeVisible();
    await page.goto("/tickets");
    await expect(page.getByRole("link", { name: `First question ${stamp}` })).toBeVisible();

    await logoutViaUi(page);
    await loginViaUi(page, email.toUpperCase(), PASSWORD);
    // Sign-in returns to where the person was heading (the app remembers the last protected page), so either landing is correct.
    await expect(page).toHaveURL(/\/(dashboard|tickets)$/);
    await page.goto("/tickets");
    await expect(page.getByRole("link", { name: `First question ${stamp}` })).toBeVisible();
  });

  test("5. a second registration with the same email gets a generic message and a Sign In link", async ({ page }) => {
    await page.goto("/register");
    await fillRegistration(page, email);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("alert")).toContainText("We could not create an account with these details");
    await expect(page.getByRole("link", { name: "Go to Sign In" })).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  test("6. the new author cannot reach admin screens or admin APIs", async ({ page, request }) => {
    await loginViaUi(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/admin/dashboard");
    await expect(page.getByRole("heading", { name: "Access Restricted" })).toBeVisible();
    await page.goto("/admin/queue");
    await expect(page.getByRole("heading", { name: "Access Restricted" })).toBeVisible();

    await apiLogin(request, email, PASSWORD);
    const rt = runtime();
    expect((await request.get(`${rt.apiOrigin}/api/v1/admin/tickets`)).status()).toBe(403);
    // Another author's data stays invisible.
    const seeded = await prisma.ticket.findFirst({ where: { author: { externalAuthorId: "SYN-A001" } } });
    if (seeded) expect((await request.get(`${rt.apiOrigin}/api/v1/author/tickets/${seeded.id}`)).status()).toBe(404);
  });

  test("7. the public endpoint rejects a role field and never creates an admin", async ({ request }) => {
    const rt = runtime();
    const admins = await prisma.user.count({ where: { role: "ADMIN" } });
    const res = await request.post(`${rt.apiOrigin}/api/v1/auth/register`, {
      headers: { Origin: rt.webOrigin },
      data: { name: "Mallory", email: `mallory.${stamp}@example.test`, password: PASSWORD, confirmPassword: PASSWORD, role: "ADMIN" }
    });
    expect(res.status()).toBe(400);
    expect(await prisma.user.count({ where: { email: `mallory.${stamp}@example.test` } })).toBe(0);
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(admins);
  });

  test("8. existing seeded author and admin can still sign in (regression)", async ({ page }) => {
    const rt = runtime();
    await loginViaUi(page, authorEmail(2), rt.authorPassword);
    await expect(page).toHaveURL(/\/dashboard$/);
    await logoutViaUi(page);
    await loginViaUi(page, rt.adminEmail, rt.adminPassword);
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
  });
});

test.describe("mobile (375x812)", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const email = `mobile.author.${stamp}@example.test`;

  test("9. the form fits the screen with no horizontal scroll and works end to end", async ({ page }) => {
    await page.goto("/register");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const control of [page.getByLabel("Full name"), page.getByLabel("Email address"), page.locator("#register-password"), page.locator("#register-confirm"), page.getByRole("button", { name: "Create account" })]) {
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      expect(box, "control has a box").toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    }
    expect((await page.getByRole("button", { name: "Create account" }).boundingBox())!.height).toBeGreaterThanOrEqual(40);

    await fillRegistration(page, email, "Test Registrant");
    await page.getByRole("button", { name: "Create account" }).tap();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 });
    const after = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(after).toBeLessThanOrEqual(0);
  });

  test("10. error states also fit on a phone", async ({ page }) => {
    await page.goto("/register");
    await page.getByRole("button", { name: "Create account" }).tap();
    await expect(page.getByText("Enter your full name.")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("keyboard and accessibility", () => {
  test("11. the whole flow works with the keyboard", async ({ page }) => {
    const email = `keyboard.author.${stamp}@example.test`;
    await page.goto("/register");
    await page.getByLabel("Full name").focus();
    await page.keyboard.type("Kiran Rao");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Email address")).toBeFocused();
    await page.keyboard.type(email);
    await page.keyboard.press("Tab");
    await expect(page.locator("#register-password")).toBeFocused();
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Show password", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#register-confirm")).toBeFocused();
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 });
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });
});
