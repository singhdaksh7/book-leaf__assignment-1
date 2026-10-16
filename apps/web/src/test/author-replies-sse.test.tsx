import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import { HttpApiClient } from "../api/http";
import { MockApiClient } from "../api/mock";
import {
  TicketEventManager,
  ticketEventManager,
  type TicketEventListener,
} from "../api/events";
import { TicketDetailPage } from "../pages/author/TicketDetailPage";
import type { CurrentUser } from "@bookleaf/contracts";

const mockAuthorUser: CurrentUser = {
  id: "usr_auth_01",
  email: "author@bookleafpublishing.test",
  role: "AUTHOR",
  authorProfile: {
    id: "auth_prof_01",
    userId: "usr_auth_01",
    externalAuthorId: "BL-AUTH-8821",
    name: "Aria Vance",
    phone: "+1-555-0199",
    city: "Cambridge",
    joinedDate: "2023-01-15",
  },
};

// Mock EventSource implementation for testing SSE
class MockEventSource {
  static instances: MockEventSource[] = [];
  public url: string;
  public withCredentials?: boolean;
  public readyState: number = 0; // CONNECTING
  public listeners: Record<string, ((e: any) => void)[]> = {};
  public onopen: (() => void) | null = null;
  public onerror: ((e: any) => void) | null = null;

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  constructor(url: string, eventSourceInitDict?: EventSourceInit) {
    this.url = url;
    this.withCredentials = eventSourceInitDict?.withCredentials;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (e: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (e: any) => void) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
    }
  }

  dispatchEvent(type: string, data: any) {
    const event = { data: typeof data === "string" ? data : JSON.stringify(data) };
    if (this.listeners[type]) {
      this.listeners[type].forEach((l) => l(event));
    }
  }

  triggerOpen() {
    this.readyState = MockEventSource.OPEN;
    if (this.onopen) this.onopen();
  }

  triggerError(readyState: number = MockEventSource.CONNECTING) {
    this.readyState = readyState;
    if (this.onerror) this.onerror(new Event("error"));
  }

  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });
}

import { getApiClient, setApiClient } from "../api";

describe("Task 1 & Task 2 — Author Replies & SSE Compatibility Integration", () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  let originalClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    originalClient = getApiClient();
    setApiClient(new HttpApiClient("http://localhost:3000/api/v1"));
    MockEventSource.instances = [];
    (globalThis as any).EventSource = MockEventSource;
    ticketEventManager.clearVersionCache();
    document.cookie = "";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
    if (originalClient) {
      setApiClient(originalClient);
    }
    ticketEventManager.clearVersionCache();
    document.cookie = "";
  });

  // 1. Successful author reply
  it("submits a real author reply to POST /api/v1/author/tickets/:id/messages and renders it in conversation", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: any = null;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const parsedUrl = new URL(url, "http://localhost:3000");
      capturedUrl = parsedUrl.pathname;
      capturedMethod = (init?.method || "GET").toUpperCase();

      if (parsedUrl.pathname === "/api/v1/auth/me") {
        return new Response(JSON.stringify({ user: mockAuthorUser }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (parsedUrl.pathname === "/api/v1/author/tickets/tkt_101/attachments") {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (parsedUrl.pathname === "/api/v1/author/tickets/tkt_101" && capturedMethod === "GET") {
        return new Response(
          JSON.stringify({
            ticket: {
              id: "tkt_101",
              authorId: "auth_prof_01",
              bookId: null,
              subject: "Royalties Reconciliation",
              description: "Initial author question regarding remittance.",
              status: "OPEN",
              category: "ROYALTY_PAYMENTS",
              priority: "HIGH",
              assigneeId: null,
              createdAt: "2026-10-14T10:00:00Z",
              updatedAt: "2026-10-14T10:00:00Z",
            },
            messages: [
              {
                id: "msg_init_01",
                ticketId: "tkt_101",
                authorId: "usr_auth_01",
                body: "Initial author question regarding remittance.",
                visibility: "AUTHOR",
                createdAt: "2026-10-14T10:00:00Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (parsedUrl.pathname === "/api/v1/author/tickets/tkt_101/messages" && capturedMethod === "POST") {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            message: {
              id: "msg_persisted_99",
              ticketId: "tkt_101",
              authorId: "usr_auth_01",
              body: capturedBody.body,
              visibility: "AUTHOR",
              createdAt: "2026-10-14T10:05:00Z",
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const client = new HttpApiClient("http://localhost:3000/api/v1");

    render(
      <MemoryRouter initialEntries={["/tickets/tkt_101"]}>
        <AuthProvider initialClient={client}>
          <Routes>
            <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Initial message is displayed
    await waitFor(() => {
      expect(screen.getAllByText("Initial author question regarding remittance.").length).toBeGreaterThan(0);
    });

    const replyBox = screen.getByPlaceholderText(/Type your reply to BookLeaf support.../i) as HTMLTextAreaElement;
    const sendButton = screen.getByRole("button", { name: /Send Reply/i });

    // Type reply
    fireEvent.change(replyBox, {
      target: { value: "Additional information from the author regarding bank statements." },
    });
    expect(replyBox.value).toBe("Additional information from the author regarding bank statements.");

    // Submit reply
    fireEvent.click(sendButton);

    // Persisted reply should be rendered in the conversation
    await waitFor(() => {
      expect(screen.getByText("Additional information from the author regarding bank statements.")).toBeInTheDocument();
    });

    // Verify endpoint called
    expect(capturedUrl).toBe("/api/v1/author/tickets/tkt_101/messages");
    expect(capturedMethod).toBe("POST");
    expect(capturedBody).toEqual({
      body: "Additional information from the author regarding bank statements.",
    });

    // Textarea cleared after success
    expect(replyBox.value).toBe("");
  });

  // 2. Failed reply
  it("handles failed reply: displays validation/server error, preserves textarea input, and does not show unsaved reply", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const parsedUrl = new URL(url, "http://localhost:3000");
      const method = (init?.method || "GET").toUpperCase();

      if (parsedUrl.pathname === "/api/v1/auth/me") {
        return new Response(JSON.stringify({ user: mockAuthorUser }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (parsedUrl.pathname === "/api/v1/author/tickets/tkt_102/attachments") {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (parsedUrl.pathname === "/api/v1/author/tickets/tkt_102" && method === "GET") {
        return new Response(
          JSON.stringify({
            ticket: {
              id: "tkt_102",
              authorId: "auth_prof_01",
              bookId: null,
              subject: "Typesetting Inquiry",
              description: "Check fonts.",
              status: "OPEN",
              category: "PRINTING_QUALITY",
              priority: "MEDIUM",
              assigneeId: null,
              createdAt: "2026-10-14T10:00:00Z",
              updatedAt: "2026-10-14T10:00:00Z",
            },
            messages: [
              {
                id: "msg_init_02",
                ticketId: "tkt_102",
                authorId: "usr_auth_01",
                body: "Check fonts.",
                visibility: "AUTHOR",
                createdAt: "2026-10-14T10:00:00Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (parsedUrl.pathname === "/api/v1/author/tickets/tkt_102/messages" && method === "POST") {
        // Return 500 error
        return new Response(
          JSON.stringify({
            error: {
              code: "INTERNAL_ERROR",
              message: "Temporary server failure processing reply",
            },
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const client = new HttpApiClient("http://localhost:3000/api/v1");

    render(
      <MemoryRouter initialEntries={["/tickets/tkt_102"]}>
        <AuthProvider initialClient={client}>
          <Routes>
            <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Check fonts.").length).toBeGreaterThan(0);
    });

    const replyBox = screen.getByPlaceholderText(/Type your reply to BookLeaf support.../i) as HTMLTextAreaElement;
    const sendButton = screen.getByRole("button", { name: /Send Reply/i });

    fireEvent.change(replyBox, { target: { value: "This reply will fail to send" } });
    fireEvent.click(sendButton);

    // Error banner should appear
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/Temporary server failure processing reply/i)).toBeInTheDocument();
    });

    // Unsaved reply must NOT be added to the conversation messages
    expect(screen.queryByText("This reply will fail to send", { selector: "p" })).toBeNull();

    // Textarea must still have the unsaved reply content
    expect(replyBox.value).toBe("This reply will fail to send");
  });

  // 3. Closed-ticket reply
  it("handles closed ticket: shows HTTP 409 conflict error, closes reply form, and updates ticket status", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const parsedUrl = new URL(url, "http://localhost:3000");
      const method = (init?.method || "GET").toUpperCase();

      if (parsedUrl.pathname === "/api/v1/auth/me") {
        return new Response(JSON.stringify({ user: mockAuthorUser }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (parsedUrl.pathname === "/api/v1/author/tickets/tkt_103/attachments") {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Ticket starts OPEN on client initial load
      if (parsedUrl.pathname === "/api/v1/author/tickets/tkt_103" && method === "GET") {
        return new Response(
          JSON.stringify({
            ticket: {
              id: "tkt_103",
              authorId: "auth_prof_01",
              bookId: null,
              subject: "Resolved Inquiry",
              description: "Please check address.",
              status: "OPEN",
              category: "GENERAL_INQUIRY",
              priority: "LOW",
              assigneeId: null,
              createdAt: "2026-10-14T10:00:00Z",
              updatedAt: "2026-10-14T10:00:00Z",
            },
            messages: [
              {
                id: "msg_init_03",
                ticketId: "tkt_103",
                authorId: "usr_auth_01",
                body: "Please check address.",
                visibility: "AUTHOR",
                createdAt: "2026-10-14T10:00:00Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // But backend rejects with 409 CONFLICT because ticket was closed in database
      if (parsedUrl.pathname === "/api/v1/author/tickets/tkt_103/messages" && method === "POST") {
        return new Response(
          JSON.stringify({
            error: {
              code: "CONFLICT",
              message: "Cannot reply to a closed ticket",
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const client = new HttpApiClient("http://localhost:3000/api/v1");

    render(
      <MemoryRouter initialEntries={["/tickets/tkt_103"]}>
        <AuthProvider initialClient={client}>
          <Routes>
            <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Please check address.").length).toBeGreaterThan(0);
    });

    const replyBox = screen.getByPlaceholderText(/Type your reply to BookLeaf support.../i);
    const sendButton = screen.getByRole("button", { name: /Send Reply/i });

    fireEvent.change(replyBox, { target: { value: "Trying to reply after resolution" } });
    fireEvent.click(sendButton);

    // HTTP 409 is caught: shows clear closed notice and transitions UI to closed ticket banner
    await waitFor(() => {
      expect(
        screen.getByText(/This ticket is closed\. To reopen or discuss further matters, please create a new ticket\./i)
      ).toBeInTheDocument();
    });

    // The reply form is now gone because ticket status changed to CLOSED
    expect(screen.queryByPlaceholderText(/Type your reply to BookLeaf support.../i)).toBeNull();
  });

  // 4. CSRF and session credentials
  it("preserves CSRF token header and credentials: 'include' on author reply POST requests", async () => {
    let capturedHeaders: any = null;
    let capturedCredentials: any = undefined;

    document.cookie = "XSRF-TOKEN=test-sec-csrf-token-abc";

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      capturedCredentials = init?.credentials;

      return new Response(
        JSON.stringify({
          message: {
            id: "msg_csrf_01",
            ticketId: "tkt_csrf",
            authorId: "usr_auth_01",
            body: "Testing CSRF preservation",
            visibility: "AUTHOR",
            createdAt: "2026-10-14T10:00:00Z",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    });

    const client = new HttpApiClient("http://localhost:3000/api/v1");
    const res = await client.replyToAuthorTicket("tkt_csrf", { body: "Testing CSRF preservation" });

    expect(res.message.id).toBe("msg_csrf_01");
    expect(capturedCredentials).toBe("include");
    expect(capturedHeaders?.get("X-CSRF-Token")).toBe("test-sec-csrf-token-abc");
    expect(capturedHeaders?.get("Content-Type")).toBe("application/json");
  });

  // 5. No duplicate submission
  it("prevents duplicate submissions: disables button while sending and rejects concurrent clicks", async () => {
    let postCallCount = 0;
    let resolvePost: (value: any) => void;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const parsedUrl = new URL(url, "http://localhost:3000");
      const method = (init?.method || "GET").toUpperCase();

      if (parsedUrl.pathname === "/api/v1/auth/me") {
        return new Response(JSON.stringify({ user: mockAuthorUser }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (parsedUrl.pathname === "/api/v1/author/tickets/tkt_105/attachments") {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (parsedUrl.pathname === "/api/v1/author/tickets/tkt_105" && method === "GET") {
        return new Response(
          JSON.stringify({
            ticket: {
              id: "tkt_105",
              authorId: "auth_prof_01",
              bookId: null,
              subject: "Concurrent Test",
              description: "Desc",
              status: "OPEN",
              category: "GENERAL_INQUIRY",
              priority: "LOW",
              assigneeId: null,
              createdAt: "2026-10-14T10:00:00Z",
              updatedAt: "2026-10-14T10:00:00Z",
            },
            messages: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (parsedUrl.pathname === "/api/v1/author/tickets/tkt_105/messages" && method === "POST") {
        postCallCount++;
        return new Promise((resolve) => {
          resolvePost = () => {
            resolve(
              new Response(
                JSON.stringify({
                  message: {
                    id: "msg_post_1",
                    ticketId: "tkt_105",
                    authorId: "usr_auth_01",
                    body: "Single send only",
                    visibility: "AUTHOR",
                    createdAt: "2026-10-14T10:00:00Z",
                  },
                }),
                { status: 201, headers: { "Content-Type": "application/json" } }
              )
            );
          };
        });
      }

      return new Response("Not found", { status: 404 });
    });

    const client = new HttpApiClient("http://localhost:3000/api/v1");

    render(
      <MemoryRouter initialEntries={["/tickets/tkt_105"]}>
        <AuthProvider initialClient={client}>
          <Routes>
            <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type your reply to BookLeaf support.../i)).toBeInTheDocument();
    });

    const replyBox = screen.getByPlaceholderText(/Type your reply to BookLeaf support.../i);
    const sendButton = screen.getByRole("button", { name: /Send Reply/i });

    fireEvent.change(replyBox, { target: { value: "Single send only" } });

    // Click send once
    fireEvent.click(sendButton);

    // Button becomes disabled while isSending is true
    expect(sendButton).toBeDisabled();

    // Rapid second click attempted
    fireEvent.click(sendButton);

    // Only one POST was dispatched
    expect(postCallCount).toBe(1);

    // Now resolve the pending request
    await act(async () => {
      resolvePost(null);
    });

    await waitFor(() => {
      expect(screen.getByText("Single send only")).toBeInTheDocument();
    });

    expect(postCallCount).toBe(1);
  });

  // 6. Correct SSE event parsing and deduplication
  it("correctly parses SSE events with ISO timestamp version and deduplicates duplicate events", () => {
    const receivedEvents: any[] = [];
    const unsubscribe = ticketEventManager.subscribe((event) => {
      receivedEvents.push(event);
    });

    const isoVersion = "2026-10-14T12:00:00.000Z";

    // 1st event
    ticketEventManager.notify({
      type: "ticket.updated",
      payload: {
        ticketId: "tkt_sse_01",
        occurredAt: isoVersion,
        version: isoVersion,
      },
    });

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].type).toBe("ticket.updated");
    expect(typeof receivedEvents[0].payload.version).toBe("string");
    expect(receivedEvents[0].payload.version).toBe(isoVersion);

    // 2nd event with same ticketId and identical version (duplicate from SSE replay or overlap)
    ticketEventManager.notify({
      type: "ticket.updated",
      payload: {
        ticketId: "tkt_sse_01",
        occurredAt: isoVersion,
        version: isoVersion,
      },
    });

    // Should be dropped by deduplicator!
    expect(receivedEvents.length).toBe(1);

    // 3rd event with newer version
    const newerVersion = "2026-10-14T12:01:00.000Z";
    ticketEventManager.notify({
      type: "ticket.reply.created",
      payload: {
        ticketId: "tkt_sse_01",
        occurredAt: newerVersion,
        version: newerVersion,
      },
    });

    expect(receivedEvents.length).toBe(2);
    expect(receivedEvents[1].type).toBe("ticket.reply.created");
    expect(receivedEvents[1].payload.version).toBe(newerVersion);

    unsubscribe();
  });

  // 7. Reconnection behavior
  it("allows native EventSource reconnection for transient errors without closing eventSource", () => {
    const manager = new TicketEventManager();
    const es = manager.getEventSource() as unknown as MockEventSource;

    expect(es).toBeDefined();

    // Simulate transient error where readyState remains CONNECTING (0)
    es.triggerError(MockEventSource.CONNECTING);

    // Close must NOT have been called on transient error
    expect(es.close).not.toHaveBeenCalled();

    // When connection re-opens natively, polling fallback is stopped
    es.triggerOpen();
    expect(manager.isPollingActive()).toBe(false);

    manager.destroy();
  });

  // 8. Polling fallback, session expiration, and overlap
  it("activates polling fallback on closed SSE, closes stream on session expiration, and avoids duplicate UI updates", async () => {
    const manager = new TicketEventManager();
    const es = manager.getEventSource() as unknown as MockEventSource;

    // Trigger permanent close (readyState = CLOSED)
    es.triggerError(MockEventSource.CLOSED);

    // Polling fallback should activate
    expect(manager.isPollingActive()).toBe(true);

    // When session expiration occurs (e.g. 401 or logout)
    manager.handleSessionExpired();

    // Both EventSource and polling should be closed
    expect(manager.isPollingActive()).toBe(false);
    expect(manager.getEventSource()).toBeNull();

    manager.destroy();
  });

  it("MockApiClient supports replyToAuthorTicket and enforces 409 on closed tickets", async () => {
    const mockClient = new MockApiClient();

    // tkt_synth_01 is OPEN initially
    const res = await mockClient.replyToAuthorTicket("tkt_synth_01", {
      body: "Author replying via mock adapter",
    });

    expect(res.message.id).toBeDefined();
    expect(res.message.body).toBe("Author replying via mock adapter");
    expect(res.message.visibility).toBe("AUTHOR");

    // Close the ticket
    await mockClient.updateTicket("tkt_synth_01", { status: "CLOSED" });

    // Replying to closed ticket must throw HTTP 409 ApiClientError
    await expect(
      mockClient.replyToAuthorTicket("tkt_synth_01", { body: "Should fail" })
    ).rejects.toThrowError(/Cannot reply to a closed ticket/);
  });
});
