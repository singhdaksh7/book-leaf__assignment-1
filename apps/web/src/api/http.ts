import {
  loginResponseSchema,
  meResponseSchema,
  bookListResponseSchema,
  bookSchema,
  ticketListResponseSchema,
  ticketDetailResponseSchema,
  ticketResponseSchema,
  adminQueueResponseSchema,
  adminTicketDetailResponseSchema,
  ticketMessageResponseSchema,
  internalNoteResponseSchema,
  assignmentResponseSchema,
  aiAnalysisResponseSchema,
  aiAnalysisRequestResponseSchema,
  apiErrorSchema,
  type LoginRequest,
  type LoginResponse,
  type MeResponse,
  type BookListResponse,
  type Book,
  type TicketListResponse,
  type TicketDetailResponse,
  type CreateTicketRequest,
  type TicketResponse,
  type TicketFilter,
  type AdminQueueResponse,
  type AdminTicketDetailResponse,
  type UpdateTicketRequest,
  type TicketReplyRequest,
  type InternalNoteRequest,
  type InternalNoteResponse,
  type TicketMessageResponse,
  type AssignTicketRequest,
  type AssignmentResponse,
  type AiAnalysisResponse,
  type AiAnalysisRequestResponse,
} from "@bookleaf/contracts";
import { type ApiClient, ApiClientError } from "./client";

function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)(?:XSRF-TOKEN|csrfToken|_csrf)=([^;]+)/);
  if (match && match[1]) {
    return decodeURIComponent(match[1]);
  }
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta) {
    return meta.getAttribute("content");
  }
  return null;
}

export class HttpApiClient implements ApiClient {
  public readonly isMock = false;
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || (import.meta.env.VITE_API_BASE_URL as string) || "/api/v1").replace(/\/+$/, "");
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    schema?: { parse: (data: unknown) => T }
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(options.headers || {});

    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }

    const method = (options.method || "GET").toUpperCase();
    const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

    if (isMutating && options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    if (isMutating) {
      const csrfToken = getCsrfToken();
      if (csrfToken && !headers.has("X-CSRF-Token")) {
        headers.set("X-CSRF-Token", csrfToken);
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
        credentials: "include",
      });
    } catch (networkError) {
      throw new ApiClientError(
        "NETWORK_ERROR",
        networkError instanceof Error ? networkError.message : "Failed to connect to BookLeaf server",
        0
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    let data: unknown;
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      try {
        data = await response.json();
      } catch {
        data = null;
      }
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const parsedError = apiErrorSchema.safeParse(data);
      if (parsedError.success) {
        const { code, message, details, requestId } = parsedError.data.error;
        throw new ApiClientError(code, message, response.status, details, requestId);
      }
      throw new ApiClientError(
        `HTTP_${response.status}`,
        typeof data === "string" ? data : `Request failed with status ${response.status}`,
        response.status
      );
    }

    if (schema) {
      try {
        return schema.parse(data);
      } catch (validationErr) {
        console.error("API Contract schema validation failed on path:", path, validationErr, data);
        throw new ApiClientError(
          "CONTRACT_VALIDATION_ERROR",
          "Response from server did not match the expected API contract schema",
          response.status,
          validationErr
        );
      }
    }

    return data as T;
  }

  // Auth
  async login(request: LoginRequest): Promise<LoginResponse> {
    return this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify(request),
    }, loginResponseSchema);
  }

  async logout(): Promise<void> {
    await this.request("/auth/logout", { method: "POST" });
  }

  async getCurrentUser(): Promise<MeResponse> {
    return this.request("/auth/me", { method: "GET" }, meResponseSchema);
  }

  // Author - Books
  async getBooks(params?: { page?: number; pageSize?: number }): Promise<BookListResponse> {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.pageSize) query.set("pageSize", String(params.pageSize));
    const qs = query.toString();
    return this.request(`/author/books${qs ? `?${qs}` : ""}`, { method: "GET" }, bookListResponseSchema);
  }

  async getBookById(bookId: string): Promise<Book> {
    // Under author/books/:id or by querying books list
    return this.request(`/author/books/${encodeURIComponent(bookId)}`, { method: "GET" }, bookSchema);
  }

  // Author - Tickets
  async getTickets(filters?: TicketFilter): Promise<TicketListResponse> {
    const query = new URLSearchParams();
    if (filters?.status) query.set("status", filters.status);
    if (filters?.category) query.set("category", filters.category);
    if (filters?.priority) query.set("priority", filters.priority);
    if (filters?.from) query.set("from", filters.from.toISOString());
    if (filters?.to) query.set("to", filters.to.toISOString());
    if (filters?.page) query.set("page", String(filters.page));
    if (filters?.pageSize) query.set("pageSize", String(filters.pageSize));
    const qs = query.toString();
    return this.request(`/author/tickets${qs ? `?${qs}` : ""}`, { method: "GET" }, ticketListResponseSchema);
  }

  async getTicketById(ticketId: string): Promise<TicketDetailResponse> {
    return this.request(`/author/tickets/${encodeURIComponent(ticketId)}`, { method: "GET" }, ticketDetailResponseSchema);
  }

  async createTicket(request: CreateTicketRequest): Promise<TicketResponse> {
    return this.request("/author/tickets", {
      method: "POST",
      body: JSON.stringify(request),
    }, ticketResponseSchema);
  }

  // Admin
  async getAdminTickets(filters?: TicketFilter): Promise<AdminQueueResponse> {
    const query = new URLSearchParams();
    if (filters?.status) query.set("status", filters.status);
    if (filters?.category) query.set("category", filters.category);
    if (filters?.priority) query.set("priority", filters.priority);
    if (filters?.from) query.set("from", filters.from.toISOString());
    if (filters?.to) query.set("to", filters.to.toISOString());
    if (filters?.page) query.set("page", String(filters.page));
    if (filters?.pageSize) query.set("pageSize", String(filters.pageSize));
    const qs = query.toString();
    return this.request(`/admin/tickets${qs ? `?${qs}` : ""}`, { method: "GET" }, adminQueueResponseSchema);
  }

  async getAdminTicketById(ticketId: string): Promise<AdminTicketDetailResponse> {
    return this.request(`/admin/tickets/${encodeURIComponent(ticketId)}`, { method: "GET" }, adminTicketDetailResponseSchema);
  }

  async updateTicket(ticketId: string, request: UpdateTicketRequest): Promise<TicketResponse> {
    return this.request(`/admin/tickets/${encodeURIComponent(ticketId)}`, {
      method: "PATCH",
      body: JSON.stringify(request),
    }, ticketResponseSchema);
  }

  async replyToTicket(ticketId: string, request: TicketReplyRequest): Promise<TicketMessageResponse> {
    return this.request(`/admin/tickets/${encodeURIComponent(ticketId)}/replies`, {
      method: "POST",
      body: JSON.stringify(request),
    }, ticketMessageResponseSchema);
  }

  async addInternalNote(ticketId: string, request: InternalNoteRequest): Promise<InternalNoteResponse> {
    return this.request(`/admin/tickets/${encodeURIComponent(ticketId)}/internal-notes`, {
      method: "POST",
      body: JSON.stringify(request),
    }, internalNoteResponseSchema);
  }

  async assignTicket(ticketId: string, request: AssignTicketRequest): Promise<AssignmentResponse> {
    return this.request(`/admin/tickets/${encodeURIComponent(ticketId)}/assignment`, {
      method: "PUT",
      body: JSON.stringify(request),
    }, assignmentResponseSchema);
  }

  async triggerAiAnalysis(ticketId: string): Promise<AiAnalysisRequestResponse> {
    return this.request(`/admin/tickets/${encodeURIComponent(ticketId)}/ai-analysis`, {
      method: "POST",
    }, aiAnalysisRequestResponseSchema);
  }

  async getAiAnalysis(ticketId: string): Promise<AiAnalysisResponse> {
    return this.request(`/admin/tickets/${encodeURIComponent(ticketId)}/ai-analysis`, {
      method: "GET",
    }, aiAnalysisResponseSchema);
  }
}
