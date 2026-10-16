import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import { HttpApiClient } from "../api/http";
import { ApiClientError } from "../api/client";
import {
  validateAttachmentFile,
  extractSafeFileName,
  sanitizeFileName,
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "../api/attachments";
import { NewTicketPage } from "../pages/author/NewTicketPage";
import { TicketDetailPage } from "../pages/author/TicketDetailPage";
import { AdminTicketDetailPage } from "../pages/admin/AdminTicketDetailPage";

describe("Attachment Upload & Download Integration Suite", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.cookie = "";
  });

  // 1. Raw-body upload request
  it("sends raw file bytes as request body without multipart/form-data or json wrapping", async () => {
    let capturedBody: unknown = null;
    let capturedContentType: string | null = null;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedBody = init?.body;
      const headers = new Headers(init?.headers);
      capturedContentType = headers.get("Content-Type");
      return new Response(
        JSON.stringify({
          attachment: {
            id: "att_001",
            ticketId: "tkt_100",
            fileName: "proof.pdf",
            contentType: "application/pdf",
            sizeBytes: 1024,
            createdAt: "2024-04-01T12:00:00Z",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    });

    const client = new HttpApiClient("http://localhost:3000/api/v1");
    const testFile = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "proof.pdf", {
      type: "application/pdf",
    });

    const res = await client.uploadAttachment("tkt_100", testFile);

    expect(res.attachment.id).toBe("att_001");
    expect(capturedContentType).toBe("application/pdf");
    expect(capturedContentType).not.toContain("multipart/form-data");
    expect(capturedContentType).not.toContain("application/json");
    // Body should be an ArrayBuffer representing raw bytes
    expect(capturedBody).toBeInstanceOf(ArrayBuffer);
  });

  // 2. Correct URL-encoded filename
  it("encodes query parameter filename correctly with special characters and spaces", async () => {
    let capturedUrl = "";

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          attachment: {
            id: "att_002",
            ticketId: "tkt_101",
            fileName: "Royalty Statement & Tax (Q1)#1.pdf",
            contentType: "application/pdf",
            sizeBytes: 512,
            createdAt: "2024-04-01T12:00:00Z",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    });

    const client = new HttpApiClient("http://localhost:3000/api/v1");
    const rawName = "Royalty Statement & Tax (Q1)#1.pdf";
    const testFile = new File(["dummy pdf content"], rawName, { type: "application/pdf" });

    await client.uploadAttachment("tkt_101", testFile);

    const parsedUrl = new URL(capturedUrl);
    expect(parsedUrl.pathname).toBe("/api/v1/author/tickets/tkt_101/attachments");
    expect(parsedUrl.searchParams.get("filename")).toBe(rawName);
    expect(capturedUrl).toContain(encodeURIComponent(rawName));
  });

  // 3. CSRF header and session credentials
  it("includes X-CSRF-Token header and credentials 'include' on upload", async () => {
    let capturedHeaders: Headers | null = null;
    let capturedCredentials: RequestCredentials | undefined = undefined;

    // Simulate CSRF cookie
    document.cookie = "XSRF-TOKEN=test-csrf-token-xyz; Path=/";

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      capturedCredentials = init?.credentials;
      return new Response(
        JSON.stringify({
          attachment: {
            id: "att_003",
            ticketId: "tkt_102",
            fileName: "notes.txt",
            contentType: "text/plain",
            sizeBytes: 12,
            createdAt: "2024-04-01T12:00:00Z",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    });

    const client = new HttpApiClient("http://localhost:3000/api/v1");
    const testFile = new File(["sample text"], "notes.txt", { type: "text/plain" });

    await client.uploadAttachment("tkt_102", testFile);

    expect((capturedHeaders as Headers | null)?.get("X-CSRF-Token")).toBe("test-csrf-token-xyz");
    expect(capturedCredentials).toBe("include");
  });


  // 4. Allowed and disallowed file types
  it("validates allowed and disallowed file types accurately on the client", () => {
    // Allowed types: PDF, PNG, JPEG, WebP, Plain Text
    const validPdf = new File(["pdf"], "doc.pdf", { type: "application/pdf" });
    const validPng = new File(["png"], "image.png", { type: "image/png" });
    const validJpg = new File(["jpg"], "photo.jpg", { type: "image/jpeg" });
    const validWebp = new File(["webp"], "graphic.webp", { type: "image/webp" });
    const validTxt = new File(["text"], "readme.txt", { type: "text/plain" });

    expect(validateAttachmentFile(validPdf).valid).toBe(true);
    expect(validateAttachmentFile(validPng).valid).toBe(true);
    expect(validateAttachmentFile(validJpg).valid).toBe(true);
    expect(validateAttachmentFile(validWebp).valid).toBe(true);
    expect(validateAttachmentFile(validTxt).valid).toBe(true);

    // Disallowed types
    const invalidExe = new File(["binary"], "malware.exe", { type: "application/x-msdownload" });
    const invalidZip = new File(["zip"], "archive.zip", { type: "application/zip" });
    const invalidHtml = new File(["<html>"], "script.html", { type: "text/html" });

    const exeRes = validateAttachmentFile(invalidExe);
    expect(exeRes.valid).toBe(false);
    expect(exeRes.error).toMatch(/Unsupported file type/i);

    const zipRes = validateAttachmentFile(invalidZip);
    expect(zipRes.valid).toBe(false);
    expect(zipRes.error).toMatch(/Unsupported file type/i);

    const htmlRes = validateAttachmentFile(invalidHtml);
    expect(htmlRes.valid).toBe(false);
    expect(htmlRes.error).toMatch(/Unsupported file type/i);
  });

  // 5. File size limit
  it("enforces maximum 5 MB file size limit and non-empty file requirement", () => {
    const emptyFile = new File([], "empty.pdf", { type: "application/pdf" });
    const emptyRes = validateAttachmentFile(emptyFile);
    expect(emptyRes.valid).toBe(false);
    expect(emptyRes.error).toMatch(/cannot be empty/i);

    const fiveMbBuffer = new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES);
    const validMaxFile = new File([fiveMbBuffer], "max.pdf", { type: "application/pdf" });
    expect(validateAttachmentFile(validMaxFile).valid).toBe(true);

    const oversizedBuffer = new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES + 1024);
    const oversizedFile = new File([oversizedBuffer], "oversized.pdf", { type: "application/pdf" });
    const overRes = validateAttachmentFile(oversizedFile);
    expect(overRes.valid).toBe(false);
    expect(overRes.error).toMatch(/exceeds the 5 MB limit/i);
  });

  // 6. Successful ticket creation followed by upload
  it("creates ticket first, then uploads selected attachment and navigates to ticket detail", async () => {
    const mockClient = {
      isMock: false,
      getBooks: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0 }),
      createTicket: vi.fn().mockResolvedValue({
        ticket: {
          id: "tkt_new_777",
          authorId: "auth_01",
          bookId: null,
          subject: "Royalty reconciliation for Q2",
          description: "Detailed query for Q2 sales audit and reconciliation report.",
          status: "OPEN",
          category: null,
          priority: null,
          assigneeId: null,
          createdAt: "2024-04-01T12:00:00Z",
          updatedAt: "2024-04-01T12:00:00Z",
        },
      }),
      uploadAttachment: vi.fn().mockResolvedValue({
        attachment: {
          id: "att_777",
          ticketId: "tkt_new_777",
          fileName: "statement.pdf",
          contentType: "application/pdf",
          sizeBytes: 1024,
          createdAt: "2024-04-01T12:00:01Z",
        },
      }),
    };

    render(
      <MemoryRouter initialEntries={["/tickets/new"]}>
        <AuthProvider initialClient={mockClient as any}>
          <Routes>
            <Route path="/tickets/new" element={<NewTicketPage />} />
            <Route
              path="/tickets/:ticketId"
              element={<div data-testid="ticket-detail-view">Ticket Detail Page</div>}
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    const subjectInput = screen.getByLabelText(/Subject Summary/i);
    const descInput = screen.getByLabelText(/Detailed Description/i);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const submitBtn = screen.getByRole("button", { name: /Submit Ticket/i });

    fireEvent.change(subjectInput, { target: { value: "Royalty reconciliation for Q2" } });
    fireEvent.change(descInput, {
      target: { value: "Detailed query for Q2 sales audit and reconciliation report." },
    });

    const file = new File(["pdf contents"], "statement.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(screen.getByText("statement.pdf")).toBeInTheDocument();

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockClient.createTicket).toHaveBeenCalledWith({
        bookId: null,
        subject: "Royalty reconciliation for Q2",
        description: "Detailed query for Q2 sales audit and reconciliation report.",
      });
      expect(mockClient.uploadAttachment).toHaveBeenCalledWith("tkt_new_777", file);
      expect(screen.getByTestId("ticket-detail-view")).toBeInTheDocument();
    });
  });

  // 7. Ticket creation succeeds but upload fails
  it("shows clear partial-success state when ticket creation succeeds but upload fails", async () => {
    const mockClient = {
      isMock: false,
      getBooks: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0 }),
      createTicket: vi.fn().mockResolvedValue({
        ticket: {
          id: "tkt_partial_888",
          authorId: "auth_01",
          bookId: null,
          subject: "Copyright registration query",
          description: "Attached is the copyright certificate application for review.",
          status: "OPEN",
          category: null,
          priority: null,
          assigneeId: null,
          createdAt: "2024-04-01T12:00:00Z",
          updatedAt: "2024-04-01T12:00:00Z",
        },
      }),
      uploadAttachment: vi
        .fn()
        .mockRejectedValue(new ApiClientError("STORAGE_ERROR", "Attachment storage disk is full", 500)),
    };

    render(
      <MemoryRouter initialEntries={["/tickets/new"]}>
        <AuthProvider initialClient={mockClient as any}>
          <Routes>
            <Route path="/tickets/new" element={<NewTicketPage />} />
            <Route
              path="/tickets/:ticketId"
              element={<div data-testid="ticket-detail-view">Ticket Detail Page</div>}
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/Subject Summary/i), {
      target: { value: "Copyright registration query" },
    });
    fireEvent.change(screen.getByLabelText(/Detailed Description/i), {
      target: { value: "Attached is the copyright certificate application for review." },
    });

    const file = new File(["certificate bytes"], "copyright.pdf", { type: "application/pdf" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: /Submit Ticket/i }));

    await waitFor(() => {
      // Must not navigate away to detail
      expect(screen.queryByTestId("ticket-detail-view")).not.toBeInTheDocument();
      // Must show partial success alert mentioning created ticket
      expect(screen.getByText(/Ticket Created \(Attachment Upload Failed\)/i)).toBeInTheDocument();
      expect(screen.getByText(/tkt_partial_888/i)).toBeInTheDocument();
      expect(screen.getByText(/Attachment storage disk is full/i)).toBeInTheDocument();
      // Must offer retry button
      expect(screen.getAllByRole("button", { name: /Retry Attachment Upload/i }).length).toBeGreaterThanOrEqual(1);
    });
  });

  // 8. Retrying upload without creating another ticket
  it("retries attachment upload against the existing ticket without calling createTicket again", async () => {
    let uploadAttempts = 0;
    const mockClient = {
      isMock: false,
      getBooks: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0 }),
      createTicket: vi.fn().mockResolvedValue({
        ticket: {
          id: "tkt_retry_999",
          authorId: "auth_01",
          bookId: null,
          subject: "Banking details clarification",
          description: "Please update international wire routing numbers on file.",
          status: "OPEN",
          category: null,
          priority: null,
          assigneeId: null,
          createdAt: "2024-04-01T12:00:00Z",
          updatedAt: "2024-04-01T12:00:00Z",
        },
      }),
      uploadAttachment: vi.fn().mockImplementation(async (ticketId: string, _file: File) => {
        uploadAttempts++;
        if (uploadAttempts === 1) {
          throw new ApiClientError("NETWORK_TIMEOUT", "Upload timed out", 0);
        }
        return {
          attachment: {
            id: "att_retry_success",
            ticketId,
            fileName: "voided_check.pdf",
            contentType: "application/pdf",
            sizeBytes: 2048,
            createdAt: "2024-04-01T12:05:00Z",
          },
        };
      }),
    };

    render(
      <MemoryRouter initialEntries={["/tickets/new"]}>
        <AuthProvider initialClient={mockClient as any}>
          <Routes>
            <Route path="/tickets/new" element={<NewTicketPage />} />
            <Route
              path="/tickets/:ticketId"
              element={<div data-testid="ticket-detail-view">Ticket Detail Page</div>}
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/Subject Summary/i), {
      target: { value: "Banking details clarification" },
    });
    fireEvent.change(screen.getByLabelText(/Detailed Description/i), {
      target: { value: "Please update international wire routing numbers on file." },
    });

    const file = new File(["check data"], "voided_check.pdf", { type: "application/pdf" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    // First attempt: creates ticket, upload fails
    fireEvent.click(screen.getByRole("button", { name: /Submit Ticket/i }));

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Retry Attachment Upload/i }).length).toBeGreaterThanOrEqual(1);
      expect(mockClient.createTicket).toHaveBeenCalledTimes(1);
      expect(mockClient.uploadAttachment).toHaveBeenCalledTimes(1);
    });

    // Click retry: should ONLY call uploadAttachment, not createTicket!
    const retryButtons = screen.getAllByRole("button", { name: /Retry Attachment Upload/i });
    const firstRetry = retryButtons[0];
    expect(firstRetry).toBeDefined();
    fireEvent.click(firstRetry!);


    await waitFor(() => {
      // createTicket must still be 1 (never called again)
      expect(mockClient.createTicket).toHaveBeenCalledTimes(1);
      expect(mockClient.uploadAttachment).toHaveBeenCalledTimes(2);
      expect(mockClient.uploadAttachment).toHaveBeenLastCalledWith("tkt_retry_999", file);
      // Navigates to detail upon retry success
      expect(screen.getByTestId("ticket-detail-view")).toBeInTheDocument();
    });
  });

  // 9. Successful authenticated author download
  it("downloads author attachment with credentials and extracts filename from Content-Disposition", async () => {
    const mockFileContent = "test file binary content";
    const contentDisposition = 'attachment; filename="author_proof.pdf"; filename*=UTF-8\'\'author_proof.pdf';

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://localhost:3000/api/v1/author/tickets/tkt_auth_1/attachments/att_1");
      expect(init?.credentials).toBe("include");
      return new Response(mockFileContent, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": contentDisposition,
          "Content-Length": String(mockFileContent.length),
        },
      });
    });

    const client = new HttpApiClient("http://localhost:3000/api/v1");
    const result = await client.downloadAttachment("tkt_auth_1", "att_1");

    expect(result.fileName).toBe("author_proof.pdf");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(await result.blob.text()).toBe(mockFileContent);
  });

  // 10. Successful authenticated admin download
  it("downloads admin attachment with credentials and admin endpoint", async () => {
    const mockFileContent = "admin report content";
    const contentDisposition = 'attachment; filename="admin_audit.pdf"';

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://localhost:3000/api/v1/admin/tickets/tkt_admin_1/attachments/att_99");
      expect(init?.credentials).toBe("include");
      return new Response(mockFileContent, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": contentDisposition,
        },
      });
    });

    const client = new HttpApiClient("http://localhost:3000/api/v1");
    const result = await client.downloadAdminAttachment("tkt_admin_1", "att_99");

    expect(result.fileName).toBe("admin_audit.pdf");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(await result.blob.text()).toBe(mockFileContent);
  });

  // 11. Download failure and authorization errors
  it("handles 401, 403, and 404 download errors properly as ApiClientError", async () => {
    const client = new HttpApiClient("http://localhost:3000/api/v1");

    // 401 Unauthorized
    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(client.downloadAttachment("tkt_1", "att_1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
      message: "Authentication required",
    });

    // 403 Forbidden
    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          error: { code: "FORBIDDEN", message: "Access denied to attachment" },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(client.downloadAttachment("tkt_1", "att_1")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      message: "Access denied to attachment",
    });

    // 404 Not Found
    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          error: { code: "NOT_FOUND", message: "Attachment not found" },
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(client.downloadAttachment("tkt_1", "att_nonexistent")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      message: "Attachment not found",
    });
  });


  // 12. Safe filename handling
  it("sanitises dangerous Content-Disposition filenames and prevents directory traversal", () => {
    // Directory traversal attempt
    const traversal = 'attachment; filename="../../etc/passwd"';
    expect(extractSafeFileName(traversal, "fallback.txt")).toBe("passwd");

    // Windows drive traversal
    const winTraversal = 'attachment; filename="C:\\Windows\\System32\\cmd.exe"';
    expect(extractSafeFileName(winTraversal, "fallback.txt")).toBe("cmd.exe");

    // RFC 5987 with encoded traversal
    const encodedTraversal = "attachment; filename*=UTF-8''..%2F..%2Fsecret_plan.pdf";
    expect(extractSafeFileName(encodedTraversal, "fallback.txt")).toBe("secret_plan.pdf");

    // Control characters and forbidden characters
    const forbiddenChars = 'attachment; filename="bad\u0000file:name?*.pdf"';
    expect(extractSafeFileName(forbiddenChars, "fallback.txt")).toBe("badfilename.pdf");

    // Fallback when header is missing or empty
    expect(extractSafeFileName(null, "default_doc.pdf")).toBe("default_doc.pdf");
    expect(extractSafeFileName("", "default_doc.pdf")).toBe("default_doc.pdf");
    expect(sanitizeFileName("../../../malicious.sh")).toBe("malicious.sh");
  });

  // 13. No simulated download in live mode
  it("renders real attachment metadata in TicketDetailPage and initiates real download", async () => {
    const mockClient = {
      isMock: false,
      getTicketById: vi.fn().mockResolvedValue({
        ticket: {
          id: "tkt_live_01",
          authorId: "auth_prof_01",
          bookId: "bk_synth_001",
          subject: "Typesetting review for chapter 4",
          description: "Please check font consistency in the attached proof.",
          status: "OPEN",
          category: "TYPESETTING",
          priority: "MEDIUM",
          assigneeId: null,
          createdAt: "2024-04-01T10:00:00Z",
          updatedAt: "2024-04-01T10:00:00Z",
        },
        messages: [],
      }),
      getAttachments: vi.fn().mockResolvedValue({
        items: [
          {
            id: "att_real_99",
            ticketId: "tkt_live_01",
            fileName: "chapter_4_proof_v2.pdf",
            contentType: "application/pdf",
            sizeBytes: 1572864, // 1.5 MB
            createdAt: "2024-04-01T10:00:00Z",
          },
        ],
      }),
      downloadAttachment: vi.fn().mockResolvedValue({
        blob: new Blob(["sample content"]),
        fileName: "chapter_4_proof_v2.pdf",
      }),
    };

    render(
      <MemoryRouter initialEntries={["/tickets/tkt_live_01"]}>
        <AuthProvider initialClient={mockClient as any}>
          <Routes>
            <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Verify real attachment metadata loads
    await waitFor(() => {
      expect(screen.getByText("chapter_4_proof_v2.pdf")).toBeInTheDocument();
      expect(screen.getByText("application/pdf")).toBeInTheDocument();
      expect(screen.getByText("1.5 MB")).toBeInTheDocument();
      // Ensure the old fabricated proof_spec_tkt_live_01.pdf is NOT present
      expect(screen.queryByText(/proof_spec_tkt_live_01\.pdf/i)).not.toBeInTheDocument();
    });

    // Click download button
    const downloadBtn = screen.getByTitle(/Download chapter_4_proof_v2\.pdf/i);
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(mockClient.downloadAttachment).toHaveBeenCalledWith(
        "tkt_live_01",
        "att_real_99",
        "chapter_4_proof_v2.pdf"
      );
      expect(screen.getByText(/Downloaded "chapter_4_proof_v2\.pdf" successfully/i)).toBeInTheDocument();
    });
  });
});
