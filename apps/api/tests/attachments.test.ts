import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@bookleaf/db";
import { LocalDiskStorage } from "../src/attachments/storage.js";
import { contentDisposition, sanitiseFileName } from "../src/attachments/validate.js";
import { ADMIN_EMAIL, WEB_ORIGIN, createTestApp, loadSyntheticDataset, login, makeTicket, mutate, profileFor, resetDatabase, seedSynthetic, type Client } from "./helpers.js";

const prisma = new PrismaClient();
const dir = mkdtempSync(join(tmpdir(), "bookleaf-att-"));
const { app, config } = createTestApp(prisma, { ATTACHMENT_DIR: dir, ATTACHMENT_MAX_BYTES: "2048", ATTACHMENT_MAX_PER_TICKET: "3" });
const [authorA, authorB] = loadSyntheticDataset();

const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(100, 0x41)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 1)]);
const text = Buffer.from("plain synthetic text\n");

beforeAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(async () => {
  await resetDatabase(prisma);
  await seedSynthetic(prisma);
  rmSync(dir, { recursive: true, force: true });
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

const files = () => { try { return readdirSync(dir); } catch { return []; } };
const upload = (client: Client, ticketId: string, body: Buffer, type = "application/pdf", filename: string | null = "report.pdf") =>
  mutate(client, "post", `/api/v1/author/tickets/${ticketId}/attachments${filename === null ? "" : `?filename=${encodeURIComponent(filename)}`}`).set("Content-Type", type).send(body);

async function setup() {
  const [pa, pb] = [await profileFor(prisma, authorA!.author_id), await profileFor(prisma, authorB!.author_id)];
  const ticketA = await makeTicket(prisma, pa.id);
  const ticketB = await makeTicket(prisma, pb.id);
  return { a: await login(app, config, authorA!.email), b: await login(app, config, authorB!.email), ticketA, ticketB };
}

describe("uploading", () => {
  it("stores a valid file under a random server-chosen key and returns metadata only", async () => {
    const { a, ticketA } = await setup();
    const response = await upload(a, ticketA.id, pdf);
    expect(response.status).toBe(201);
    expect(response.body.attachment).toMatchObject({ ticketId: ticketA.id, fileName: "report.pdf", contentType: "application/pdf", sizeBytes: pdf.length });
    expect(JSON.stringify(response.body)).not.toMatch(/storageKey|sha256|uploaderId/);
    const row = await prisma.ticketAttachment.findFirstOrThrow();
    expect(row.storageKey).toMatch(/^[a-f0-9]{48}$/);
    expect(files()).toEqual([row.storageKey]);
    expect(row.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts png and text and lists them in order", async () => {
    const { a, ticketA } = await setup();
    expect((await upload(a, ticketA.id, png, "image/png", "pic.png")).status).toBe(201);
    expect((await upload(a, ticketA.id, text, "text/plain; charset=utf-8", "notes.txt")).status).toBe(201);
    const list = await a.agent.get(`/api/v1/author/tickets/${ticketA.id}/attachments`);
    expect(list.body.items.map((i: { fileName: string }) => i.fileName)).toEqual(["pic.png", "notes.txt"]);
  });

  it("rejects unsupported, mislabelled, empty, oversized and nameless files without storing anything", async () => {
    const { a, ticketA } = await setup();
    const cases: Array<[string, Buffer, string, string | null]> = [
      ["html", Buffer.from("<script>alert(1)</script>"), "text/html", "x.html"],
      ["exe", Buffer.from("MZ\x90\x00"), "application/x-msdownload", "x.exe"],
      ["octet-stream", pdf, "application/octet-stream", "x.pdf"],
      ["pdf label, png bytes", png, "application/pdf", "x.pdf"],
      ["png label, pdf bytes", pdf, "image/png", "x.png"],
      ["text with NUL", Buffer.from([0x68, 0x00, 0x69]), "text/plain", "x.txt"],
      ["text invalid utf-8", Buffer.from([0xff, 0xfe, 0xfd]), "text/plain", "x.txt"],
      ["empty", Buffer.alloc(0), "application/pdf", "x.pdf"],
      ["too large", Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(4096)]), "application/pdf", "x.pdf"],
      ["no filename", pdf, "application/pdf", null],
      ["dots-only filename", pdf, "application/pdf", "..."]
    ];
    for (const [name, body, type, filename] of cases) {
      const response = await upload(a, ticketA.id, body, type, filename);
      expect(response.status, name).toBe(400);
      expect(response.body.error.code, name).toBe("VALIDATION_ERROR");
    }
    expect(files()).toEqual([]);
    expect(await prisma.ticketAttachment.count()).toBe(0);
  });

  it("neutralises path traversal and header-unsafe filenames; storage paths never use them", async () => {
    const { a, ticketA } = await setup();
    const names = ["../../etc/passwd", "..\\..\\windows\\evil.pdf", "/abs/path/file.pdf"];
    for (const input of names) {
      const response = await upload(a, ticketA.id, pdf, "application/pdf", input);
      expect(response.status).toBe(201);
      expect(response.body.attachment.fileName).not.toMatch(/[\\/]/);
    }
    expect((await prisma.ticketAttachment.findMany({ orderBy: { createdAt: "asc" } })).map((r) => r.fileName)).toEqual(["passwd", "evil.pdf", "file.pdf"]);
    expect(files().every((f) => /^[a-f0-9]{48}$/.test(f))).toBe(true);
    expect(sanitiseFileName('a"b;c\r\nSet-Cookie: x=1.pdf')).not.toMatch(/[\r\n"]/);
    expect(contentDisposition(sanitiseFileName("na\"me;é.pdf"))).toMatch(/^attachment; filename="[^"\r\n]*"; filename\*=UTF-8''[A-Za-z0-9%._-]+$/);
  });

  it("enforces the per-ticket limit and leaves no orphan files", async () => {
    const { a, ticketA } = await setup();
    for (let i = 0; i < 3; i += 1) expect((await upload(a, ticketA.id, pdf)).status).toBe(201);
    const fourth = await upload(a, ticketA.id, pdf);
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe("CONFLICT");
    expect(files()).toHaveLength(3);
    // Concurrent uploads cannot exceed the limit either.
    const second = await makeTicket(prisma, ticketA.authorId);
    const results = await Promise.all(Array.from({ length: 6 }, () => upload(a, second.id, pdf)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(await prisma.ticketAttachment.count({ where: { ticketId: second.id } })).toBe(3);
    expect(files()).toHaveLength(6);
  });

  it("refuses uploads to closed tickets", async () => {
    const { a, ticketA } = await setup();
    await prisma.ticket.update({ where: { id: ticketA.id }, data: { status: "CLOSED" } });
    expect((await upload(a, ticketA.id, pdf)).status).toBe(409);
  });

  it("requires authentication, AUTHOR role and CSRF", async () => {
    const { a, ticketA } = await setup();
    const url = `/api/v1/author/tickets/${ticketA.id}/attachments?filename=x.pdf`;
    expect((await request(app).post(url).set("Origin", WEB_ORIGIN).set("Content-Type", "application/pdf").send(pdf)).status).toBe(401);
    expect((await a.agent.post(url).set("Origin", WEB_ORIGIN).set("Content-Type", "application/pdf").send(pdf)).status).toBe(403);
    const admin = await login(app, config, ADMIN_EMAIL);
    expect((await mutate(admin, "post", url).set("Content-Type", "application/pdf").send(pdf)).status).toBe(403);
    expect(files()).toEqual([]);
  });
});

describe("ownership and retrieval", () => {
  it("lets the owner download exactly what was uploaded, as a non-executable attachment", async () => {
    const { a, ticketA } = await setup();
    const created = await upload(a, ticketA.id, pdf, "application/pdf", "my report.pdf");
    const response = await a.agent.get(`/api/v1/author/tickets/${ticketA.id}/attachments/${created.body.attachment.id}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(response.status).toBe(200);
    expect(Buffer.compare(response.body as Buffer, pdf)).toBe(0);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="my report\.pdf"/);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain("sandbox");
  });

  it("hides attachments from other authors on every route, indistinguishably from missing ones", async () => {
    const { a, b, ticketA, ticketB } = await setup();
    const created = await upload(a, ticketA.id, pdf);
    const id = created.body.attachment.id as string;
    const mineB = await upload(b, ticketB.id, pdf);

    const attempts = [
      b.agent.get(`/api/v1/author/tickets/${ticketA.id}/attachments`),
      b.agent.get(`/api/v1/author/tickets/${ticketA.id}/attachments/${id}`),
      b.agent.get(`/api/v1/author/tickets/${ticketB.id}/attachments/${id}`), // A's attachment id under B's own ticket
      b.agent.get(`/api/v1/author/tickets/${ticketA.id}/attachments/${mineB.body.attachment.id}`), // B's attachment id under A's ticket
      upload(b, ticketA.id, pdf)
    ];
    for (const response of await Promise.all(attempts)) expect(response.status).toBe(404);
    expect((await a.agent.get(`/api/v1/author/tickets/${ticketA.id}/attachments/does-not-exist`)).status).toBe(404);
    expect(await prisma.ticketAttachment.count({ where: { ticketId: ticketA.id } })).toBe(1);
  });

  it("lets admins list and download any ticket's attachments, but not authors use those routes", async () => {
    const { a, ticketA } = await setup();
    const created = await upload(a, ticketA.id, text, "text/plain", "n.txt");
    const admin = await login(app, config, ADMIN_EMAIL);
    const list = await admin.agent.get(`/api/v1/admin/tickets/${ticketA.id}/attachments`);
    expect(list.body.items).toHaveLength(1);
    expect((await admin.agent.get(`/api/v1/admin/tickets/${ticketA.id}/attachments/${created.body.attachment.id}`)).status).toBe(200);
    expect((await a.agent.get(`/api/v1/admin/tickets/${ticketA.id}/attachments`)).status).toBe(403);
    expect((await a.agent.get(`/api/v1/admin/tickets/${ticketA.id}/attachments/${created.body.attachment.id}`)).status).toBe(403);
    expect((await request(app).get(`/api/v1/admin/tickets/${ticketA.id}/attachments`)).status).toBe(401);
    expect((await admin.agent.get(`/api/v1/admin/tickets/missing/attachments`)).status).toBe(404);
  });

  it("returns 404 (not a crash) when the stored file has gone missing", async () => {
    const { a, ticketA } = await setup();
    const created = await upload(a, ticketA.id, pdf);
    rmSync(dir, { recursive: true, force: true });
    expect((await a.agent.get(`/api/v1/author/tickets/${ticketA.id}/attachments/${created.body.attachment.id}`)).status).toBe(404);
  });
});

describe("LocalDiskStorage", () => {
  const storage = new LocalDiskStorage(join(dir, "unit"));
  const key = "a".repeat(48);

  it("rejects any key that is not a generated hex key, so traversal is impossible", async () => {
    for (const bad of ["../x", "..\\x", "/etc/passwd", "C:\\windows\\x", "a".repeat(47), `${"a".repeat(47)}/`, `${"a".repeat(46)}..`, "", "A".repeat(48)]) {
      await expect(storage.put(bad, Buffer.from("x")), bad).rejects.toThrow(/Invalid storage key/);
      await expect(storage.get(bad), bad).rejects.toThrow(/Invalid storage key/);
      await expect(storage.delete(bad), bad).rejects.toThrow(/Invalid storage key/);
    }
  });

  it("never overwrites, returns null for missing objects and deletes idempotently", async () => {
    expect(await storage.get(key)).toBeNull();
    await storage.put(key, Buffer.from("one"));
    await expect(storage.put(key, Buffer.from("two"))).rejects.toThrow();
    expect((await storage.get(key))?.toString()).toBe("one");
    await storage.delete(key);
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  });
});
