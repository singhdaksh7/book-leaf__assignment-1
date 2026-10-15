import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@bookleaf/db";
import { AiAttemptService } from "../src/ai/attempts.js";
import { canReceive, formatSse, TicketEventHub, type TicketEvent } from "../src/events/hub.js";
import { ADMIN_EMAIL, WEB_ORIGIN, cookieValue, createTestApp, loadSyntheticDataset, login, makeTicket, mutate, profileFor, resetDatabase, seedSynthetic } from "./helpers.js";
import { completedRow, fakeEngine, openStream, sleep, startServer, type SseClient } from "./m3helpers.js";

const prisma = new PrismaClient();
const [authorA, authorB] = loadSyntheticDataset();
const events = new TicketEventHub();
const ai = new AiAttemptService({ prisma, engine: fakeEngine(), events, refreshCooldownMs: 0 });
const { app, config } = createTestApp(prisma, { TICKET_CREATE_LIMIT_PER_HOUR: "1000" }, { ai, events, sseHeartbeatMs: 60 });
let server: Awaited<ReturnType<typeof startServer>>;
const open: SseClient[] = [];

beforeAll(async () => {
  server = await startServer(app);
});
beforeEach(async () => {
  open.splice(0).forEach((c) => c.close());
  await resetDatabase(prisma);
  await seedSynthetic(prisma);
});
afterAll(async () => {
  open.splice(0).forEach((c) => c.close());
  events.closeAll();
  await server.close();
  await prisma.$disconnect();
});

async function connect(email: string, headers: Record<string, string> = {}) {
  const client = await login(app, config, email);
  const cookie = `${config.sessionCookieName}=${cookieValue(client.response.headers["set-cookie"], config.sessionCookieName)}`;
  const stream = await openStream(server.port, cookie, headers);
  open.push(stream);
  return { client, cookie, stream };
}
const ownTicket = async (author = authorA!) => makeTicket(prisma, (await profileFor(prisma, author.author_id)).id, { subject: "Streamed ticket" });
const names = (list: Array<{ event: string }>) => list.map((e) => e.event);

describe("authorisation", () => {
  it("rejects anonymous and invalid sessions with the JSON error envelope", async () => {
    const anonymous = await request(app).get("/api/v1/events/tickets");
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe("UNAUTHENTICATED");
    const forged = await openStream(server.port, `${config.sessionCookieName}=${"a".repeat(43)}`);
    expect(forged.status).toBe(401);
    forged.close();
  });

  it("denies an author account without a profile", async () => {
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    await prisma.user.create({ data: { email: "orphan@example.test", role: "AUTHOR", passwordHash: adminUser.passwordHash } });
    const orphan = await login(app, config, "orphan@example.test");
    const cookie = `${config.sessionCookieName}=${cookieValue(orphan.response.headers["set-cookie"], config.sessionCookieName)}`;
    const stream = await openStream(server.port, cookie);
    expect(stream.status).toBe(403);
    stream.close();
  });

  it("opens an event stream with the right headers for authors and admins", async () => {
    for (const email of [authorA!.email, ADMIN_EMAIL]) {
      const { stream } = await connect(email);
      expect(stream.status).toBe(200);
      expect(stream.headers["content-type"]).toContain("text/event-stream");
      expect(stream.headers["cache-control"]).toContain("no-store");
      expect(stream.headers["x-accel-buffering"]).toBe("no");
    }
  });

  it("limits open streams per user", async () => {
    for (let i = 0; i < 5; i += 1) expect((await connect(authorA!.email)).stream.status).toBe(200);
    const sixth = await connect(authorA!.email);
    expect(sixth.stream.status).toBe(429);
    expect((await connect(authorB!.email)).stream.status).toBe(200); // other users are unaffected
  });
});

describe("event isolation", () => {
  it("delivers a reply only to the owning author and to admins", async () => {
    const ticket = await ownTicket(authorA!);
    const a = await connect(authorA!.email);
    const b = await connect(authorB!.email);
    const adm = await connect(ADMIN_EMAIL);
    const admin = await login(app, config, ADMIN_EMAIL);

    const reply = await mutate(admin, "post", `/api/v1/admin/tickets/${ticket.id}/replies`).send({ body: "SECRET-REPLY-BODY-9911" });
    expect(reply.status).toBe(201);

    const got = await a.stream.waitFor((e) => e.some((x) => x.event === "ticket.reply.created"));
    await adm.stream.waitFor((e) => e.some((x) => x.event === "ticket.reply.created"));
    expect(await b.stream.quiet(250)).toEqual([]);
    const event = got.find((e) => e.event === "ticket.reply.created")!;
    expect(Object.keys(event.data).sort()).toEqual(["occurredAt", "ticketId", "version"]);
    expect(event.data.ticketId).toBe(ticket.id);
    expect(Number.isNaN(Date.parse(event.data.occurredAt as string))).toBe(false);
    expect(event.id).toMatch(/^\d{10,15}-\d+$/);
    // The stream never carries message text, subjects or author data.
    for (const stream of [a.stream, adm.stream, b.stream]) expect(stream.raw()).not.toMatch(/9911|Streamed ticket|SECRET|@example/);
  });

  it("announces a new ticket to its author and admins only", async () => {
    const a = await connect(authorA!.email);
    const b = await connect(authorB!.email);
    const adm = await connect(ADMIN_EMAIL);
    const author = await login(app, config, authorA!.email);
    const created = await mutate(author, "post", "/api/v1/author/tickets").send({ bookId: null, subject: "Fresh ticket", description: "A long enough description." });
    await ai.idle();
    await a.stream.waitFor((e) => e.some((x) => x.event === "ticket.created" && x.data.ticketId === created.body.ticket.id));
    await adm.stream.waitFor((e) => e.some((x) => x.event === "ticket.created"));
    expect(names(await b.stream.quiet(250))).toEqual([]);
    expect(names(a.stream.events)).not.toContain("ticket.analysis.updated");
  });

  it("keeps internal notes and AI analysis events away from authors", async () => {
    const ticket = await ownTicket(authorA!);
    const a = await connect(authorA!.email);
    const adm = await connect(ADMIN_EMAIL);
    const admin = await login(app, config, ADMIN_EMAIL);

    await mutate(admin, "post", `/api/v1/admin/tickets/${ticket.id}/internal-notes`).send({ body: "private note" });
    await adm.stream.waitFor((e) => e.some((x) => x.event === "ticket.updated"));
    const refresh = await mutate(admin, "post", `/api/v1/admin/tickets/${ticket.id}/ai-analysis`).send({});
    expect([200, 202]).toContain(refresh.status);
    await ai.idle();
    await adm.stream.waitFor((e) => e.some((x) => x.event === "ticket.analysis.updated"));

    expect(names(await a.stream.quiet(300))).toEqual([]);
    expect(a.stream.raw()).not.toMatch(/analysis|note/i);
  });

  it("delivers status, priority and assignment changes to the owning author as ticket.updated", async () => {
    const ticket = await ownTicket(authorA!);
    const other = await ownTicket(authorB!);
    const a = await connect(authorA!.email);
    const admin = await login(app, config, ADMIN_EMAIL);
    const me = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    await mutate(admin, "patch", `/api/v1/admin/tickets/${ticket.id}`).send({ status: "IN_PROGRESS" });
    await mutate(admin, "put", `/api/v1/admin/tickets/${ticket.id}/assignment`).send({ assigneeId: me.id });
    await mutate(admin, "patch", `/api/v1/admin/tickets/${other.id}`).send({ priority: "LOW" });
    const got = await a.stream.waitFor((e) => e.filter((x) => x.event === "ticket.updated").length >= 2);
    expect(got.every((e) => e.data.ticketId === ticket.id)).toBe(true);
    await sleep(150);
    expect(a.stream.events.some((e) => e.data.ticketId === other.id)).toBe(false);
  });

  it("matches the polling resource: the event version equals the ticket's updatedAt", async () => {
    const ticket = await ownTicket(authorA!);
    const a = await connect(authorA!.email);
    const admin = await login(app, config, ADMIN_EMAIL);
    await mutate(admin, "post", `/api/v1/admin/tickets/${ticket.id}/replies`).send({ body: "Poll me too" });
    const got = await a.stream.waitFor((e) => e.some((x) => x.event === "ticket.reply.created"));
    const polled = await a.client.agent.get(`/api/v1/author/tickets/${ticket.id}`);
    expect(polled.body.ticket.updatedAt).toBe(got.find((e) => e.event === "ticket.reply.created")!.data.version);
    expect(polled.body.messages.map((m: { body: string }) => m.body)).toEqual(["Poll me too"]);
  });
});

describe("reconnects and duplicates", () => {
  it("catches up from Last-Event-ID with ticket.updated for the caller's own tickets only", async () => {
    const mine = await ownTicket(authorA!);
    const theirs = await ownTicket(authorB!);
    const longAgo = await ownTicket(authorA!);
    await prisma.ticket.update({ where: { id: longAgo.id }, data: { updatedAt: new Date(Date.now() - 3_600_000) } });
    const since = `${Date.now() - 60_000}-1`;
    await prisma.ticket.update({ where: { id: mine.id }, data: { subject: "changed" } });
    await prisma.ticket.update({ where: { id: theirs.id }, data: { subject: "changed" } });

    const a = await connect(authorA!.email, { "Last-Event-ID": since });
    const got = await a.stream.waitFor((e) => e.length >= 1);
    expect(got.map((e) => e.data.ticketId)).toEqual([mine.id]);
    expect(got[0]).toMatchObject({ event: "ticket.updated" });
    expect(got[0]!.data.version).toBe((await prisma.ticket.findUniqueOrThrow({ where: { id: mine.id } })).updatedAt.toISOString());

    const adm = await connect(ADMIN_EMAIL, { "Last-Event-ID": since });
    const adminGot = await adm.stream.waitFor((e) => e.length >= 2);
    expect(new Set(adminGot.map((e) => e.data.ticketId))).toEqual(new Set([mine.id, theirs.id]));
  });

  it("ignores malformed Last-Event-ID values and never replays on a fresh connection", async () => {
    await ownTicket(authorA!);
    for (const bad of ["abc", "-1", "99999999999999999999-1", "1700000000000", "1700000000000-1; DROP TABLE"]) {
      const { stream } = await connect(authorA!.email, { "Last-Event-ID": bad });
      expect(stream.status, bad).toBe(200);
      expect(await stream.quiet(80)).toEqual([]);
    }
  });

  it("is safe to receive the same version twice: duplicates carry identical keys", async () => {
    const ticket = await ownTicket(authorA!);
    const admin = await login(app, config, ADMIN_EMAIL);
    await mutate(admin, "post", `/api/v1/admin/tickets/${ticket.id}/replies`).send({ body: "dup test" });
    const first = await connect(authorA!.email);
    const reconnected = await connect(authorA!.email, { "Last-Event-ID": `${Date.now() - 10_000}-1` });
    await reconnected.stream.waitFor((e) => e.length >= 1);
    const polled = await first.client.agent.get(`/api/v1/author/tickets/${ticket.id}`);
    expect(reconnected.stream.events[0]!.data).toMatchObject({ ticketId: ticket.id, version: polled.body.ticket.updatedAt });
  });
});

describe("connection lifetime", () => {
  it("closes the stream on logout", async () => {
    const { client, stream } = await connect(authorA!.email);
    expect((await mutate(client, "post", "/api/v1/auth/logout").send()).status).toBe(204);
    await sleep(150);
    expect(stream.ended()).toBe(true);
  });

  it("closes when the session is revoked elsewhere or expires (heartbeat re-validation)", async () => {
    const revoked = await connect(authorA!.email);
    await prisma.session.deleteMany({ where: { user: { email: authorA!.email } } });
    await sleep(300);
    expect(revoked.stream.ended()).toBe(true);

    const expiring = await connect(authorB!.email);
    await prisma.session.updateMany({ where: { user: { email: authorB!.email } }, data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 5000) } });
    await sleep(300);
    expect(expiring.stream.ended()).toBe(true);
  });

  it("sends keep-alive comments and tolerates clients disconnecting mid-publish", async () => {
    const { stream } = await connect(authorA!.email);
    await sleep(200);
    expect(stream.raw()).toContain(": ping");
    const doomed = await connect(authorB!.email);
    doomed.stream.close();
    const ticket = await ownTicket(authorB!);
    const admin = await login(app, config, ADMIN_EMAIL);
    expect((await mutate(admin, "post", `/api/v1/admin/tickets/${ticket.id}/replies`).send({ body: "after disconnect" })).status).toBe(201);
    await sleep(100);
    expect(events.size).toBeGreaterThanOrEqual(1);
  });

  it("does not require CSRF for the read-only stream but still checks the session", async () => {
    const { stream } = await connect(authorA!.email);
    expect(stream.status).toBe(200);
    const crossOrigin = await openStream(server.port, `${config.sessionCookieName}=x`, { Origin: WEB_ORIGIN });
    expect(crossOrigin.status).toBe(401);
    crossOrigin.close();
  });
});

describe("hub and wire format", () => {
  const author = (id: string | null) => ({ role: "AUTHOR" as const, authorProfileId: id });
  const admin = { role: "ADMIN" as const, authorProfileId: null };

  it("canReceive implements the full role/ownership matrix", () => {
    const all = { authorProfileId: "p1", audience: "all" as const };
    const adminOnly = { authorProfileId: "p1", audience: "admin" as const };
    expect(canReceive(admin, all)).toBe(true);
    expect(canReceive(admin, adminOnly)).toBe(true);
    expect(canReceive(author("p1"), all)).toBe(true);
    expect(canReceive(author("p1"), adminOnly)).toBe(false);
    expect(canReceive(author("p2"), all)).toBe(false);
    expect(canReceive(author(null), all)).toBe(false);
  });

  it("a throwing subscriber is dropped without affecting others", () => {
    const hub = new TicketEventHub();
    const received: string[] = [];
    hub.subscribe({ userId: "u1", role: "ADMIN", authorProfileId: null, sessionId: "s1", deliver: () => { throw new Error("broken pipe"); }, close: () => {} });
    hub.subscribe({ userId: "u2", role: "ADMIN", authorProfileId: null, sessionId: "s2", deliver: (e) => received.push(e.ticketId), close: () => {} });
    const event: TicketEvent = { name: "ticket.updated", ticketId: "t1", authorProfileId: "p1", audience: "all", occurredAt: new Date(), version: "v" };
    expect(() => hub.publish(event)).not.toThrow();
    hub.publish(event);
    expect(received).toEqual(["t1", "t1"]);
    expect(hub.size).toBe(1);
  });

  it("formats exactly id/event/data with only the three safe fields", () => {
    const at = new Date("2026-02-03T04:05:06.000Z");
    const text = formatSse("1770000000000-1", { name: "ticket.created", ticketId: "t9", occurredAt: at, version: at.toISOString() });
    expect(text).toBe(`id: 1770000000000-1\nevent: ticket.created\ndata: {"ticketId":"t9","occurredAt":"2026-02-03T04:05:06.000Z","version":"2026-02-03T04:05:06.000Z"}\n\n`);
    expect(new TicketEventHub().nextEventId(at)).toMatch(new RegExp(`^${at.getTime()}-[0-9]+$`));
  });
});
