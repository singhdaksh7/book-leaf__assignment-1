import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const O = (process.env.BASE_URL ?? "https://bookleaf.77.37.45.177.sslip.io").replace(/\/+$/, "");
const { BL_AUTHOR_PW, BL_ADMIN_PW } = process.env;
const rows = []; const step = async (n, fn) => { try { await fn(); rows.push(true); console.log("PASS  " + n); } catch (e) { rows.push(false); console.log("FAIL  " + n + "  -> " + String(e.message).split("\n")[0].slice(0, 160)); } };
const stamp = Date.now(), subject = `Live UI journey ${stamp} royalty payment`, desc = "I published my book months ago and still have not received my royalty payment, please advise.";
const attName = "statement.txt", attText = `synthetic statement ${stamp}\n`, reply = `Author UI reply ${stamp}`, note = `INTERNAL-UI-${stamp}`;
const browser = await chromium.launch({ ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : { channel: process.env.E2E_BROWSER_CHANNEL ?? "msedge" }) });
const login = async (p, email, pw) => { await p.goto(O + "/login"); await p.locator('input[type="email"], input[name="email"]').first().fill(email); await p.locator('input[type="password"]').first().fill(pw); await p.getByRole("button", { name: /sign in/i }).click(); await p.waitForURL((u) => !u.pathname.includes("/login")); };
const actx = await browser.newContext({ acceptDownloads: true }), dctx = await browser.newContext();
const author = await actx.newPage(), admin = await dctx.newPage(); let ticketId;
author.on("dialog", (d) => d.dismiss());

await step("author signs in (UI)", async () => { await login(author, "synthetic.author1@example.test", BL_AUTHOR_PW); await expect(author).toHaveURL(/dashboard/); });
await step("author sees only own books (Synthetic Book 1/2, not 3/4)", async () => { await author.goto(O + "/books"); await expect(author.getByRole("link", { name: "Synthetic Book 1" }).first()).toBeVisible(); await expect(author.getByRole("link", { name: "Synthetic Book 3" })).toHaveCount(0); });
await step("author creates ticket with attachment (UI)", async () => {
  await author.goto(O + "/tickets/new");
  const opt = author.locator("#ticket-book option", { hasText: "Synthetic Book 1" }); await author.locator("#ticket-book").selectOption((await opt.getAttribute("value")));
  await author.getByLabel("Subject Summary").fill(subject); await author.getByLabel("Detailed Description").fill(desc);
  await author.locator('input[type="file"]').setInputFiles({ name: attName, mimeType: "text/plain", buffer: Buffer.from(attText) });
  await author.getByRole("button", { name: "Submit Ticket" }).click();
  await expect(author).toHaveURL(/\/tickets\/(?!new$)[^/?#]+$/); ticketId = author.url().split("/").pop();
  await expect(author.getByRole("heading", { name: subject })).toBeVisible(); await expect(author.getByText(attName).first()).toBeVisible();
});
await step("author downloads attachment byte-for-byte (UI)", async () => { const dl = author.waitForEvent("download"); await author.getByRole("button", { name: `Download ${attName}` }).click(); const d = await dl; if (readFileSync(await d.path(), "utf8") !== attText) throw new Error("content mismatch"); });
await step("author reply persists after reload (UI)", async () => { await author.getByPlaceholder("Type your reply to BookLeaf support...").fill(reply); await author.getByRole("button", { name: "Send Reply" }).click(); await expect(author.getByText(reply)).toBeVisible(); await author.reload(); await expect(author.getByText(reply)).toBeVisible(); });
await step("author ticket history lists the ticket (UI)", async () => { await author.goto(O + "/tickets"); await expect(author.getByText(subject).first()).toBeVisible(); await author.goto(`${O}/tickets/${ticketId}`); });

await step("admin signs in (UI)", async () => { await login(admin, "admin@example.test", BL_ADMIN_PW); await expect(admin).toHaveURL(/admin\/dashboard/); });
await step("admin opens the ticket (queue page 1 visibility recorded; direct link fallback)", async () => { await admin.goto(O + "/admin/queue"); await admin.waitForTimeout(1500); const onPage1 = await admin.getByRole("link", { name: subject }).count(); console.log("INFO  new unprioritised ticket visible on queue page 1: " + (onPage1 > 0)); if (onPage1 > 0) await admin.getByRole("link", { name: subject }).click(); else await admin.goto(O + "/admin/tickets/" + ticketId); await expect(admin).toHaveURL(new RegExp("/admin/tickets/" + ticketId + "$")); await expect(admin.getByText(reply)).toBeVisible(); });
await step("admin assigns to self, sets status (persists after reload)", async () => {
  const sel = admin.getByText("Ticket Status").locator("xpath=following::select[1]");
  await admin.getByRole("button", { name: "Assign to Me" }).click(); await expect(admin.getByText("Assigned to You")).toBeVisible();
  await sel.selectOption("IN_PROGRESS"); await admin.getByRole("button", { name: /Apply Overrides/ }).click(); await expect(admin.getByRole("button", { name: /Apply Overrides/ })).toBeEnabled();
  await admin.reload(); await expect(admin.getByText("Assigned to You")).toBeVisible(); await expect(sel).toHaveValue("IN_PROGRESS");
});
await step("admin adds internal note (persists)", async () => { await admin.getByPlaceholder("Add private note for editorial or accounting team...").fill(note); await admin.getByRole("button", { name: "Save Internal Note" }).click(); await expect(admin.getByText(note)).toBeVisible(); await admin.reload(); await expect(admin.getByText(note)).toBeVisible(); });
await step("AI panel shows demo-labelled draft; nothing auto-sent", async () => {
  await expect(async () => { await admin.reload(); await expect(admin.getByRole("button", { name: "Insert Draft into Reply Box" })).toBeVisible({ timeout: 2000 }); }).toPass({ timeout: 40000 });
  await expect(admin.getByText("Human Review Required")).toBeVisible();
  await expect(admin.getByText(/\[DEMO MOCK/).first()).toBeVisible();
  await expect(admin.getByText("BookLeaf Staff Reply")).toHaveCount(0);
});
await step("admin inserts draft, edits out the demo label, sends", async () => {
  await admin.getByRole("button", { name: "Insert Draft into Reply Box" }).click();
  const box = admin.getByPlaceholder(/Compose reply to author/); await expect(box).toHaveValue(/\[DEMO DRAFT/);
  const edited = (await box.inputValue()).replace(/\[DEMO DRAFT[^\]]*\]\s*/, ""); await box.fill(edited);
  await admin.getByRole("button", { name: "Send Reply" }).click(); await expect(admin.getByText("BookLeaf Staff Reply")).toBeVisible();
});
await step("author receives the admin reply, no label, no internal note (UI)", async () => {
  await author.reload(); await expect(author.getByText("BookLeaf Editorial Support")).toBeVisible();
  await expect(author.getByText(/royalties are calculated quarterly|Royalties are calculated quarterly/i)).toBeVisible();
  await expect(author.getByText(/DEMO DRAFT|DEMO MOCK/)).toHaveCount(0); await expect(author.getByText(note)).toHaveCount(0);
});
await step("admin downloads the attachment (UI)", async () => { const dl = admin.waitForEvent("download"); await admin.getByRole("button", { name: new RegExp(`Download ${attName}`) }).click(); const d = await dl; if (readFileSync(await d.path(), "utf8") !== attText) throw new Error("mismatch"); });
await step("author is blocked from admin UI routes", async () => { await author.goto(O + "/admin/queue"); await author.waitForTimeout(1500); if (author.url().includes("/admin/queue") && (await author.getByRole("link", { name: subject }).count()) > 0) throw new Error("author reached admin queue"); });
await step("logout (author) returns to login", async () => { await author.goto(O + "/dashboard"); const lo = author.getByRole("button", { name: /log ?out|sign ?out/i }).first(); await lo.click(); await author.waitForURL(/login/); });
await browser.close(); console.log(`\n${rows.filter(Boolean).length}/${rows.length} UI steps passed`);
