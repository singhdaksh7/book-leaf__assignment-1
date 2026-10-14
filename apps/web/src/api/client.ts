import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  BookListResponse,
  Book,
  TicketListResponse,
  TicketDetailResponse,
  CreateTicketRequest,
  TicketResponse,
  TicketFilter,
  AdminQueueResponse,
  AdminTicketDetailResponse,
  UpdateTicketRequest,
  TicketReplyRequest,
  InternalNoteRequest,
  InternalNoteResponse,
  TicketMessageResponse,
  AssignTicketRequest,
  AssignmentResponse,
  AiAnalysisResponse,
  AiAnalysisRequestResponse,
} from "@bookleaf/contracts";

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: unknown,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface ApiClient {
  readonly isMock: boolean;

  // Auth
  login(request: LoginRequest): Promise<LoginResponse>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<MeResponse>;

  // Author - Books
  getBooks(params?: { page?: number; pageSize?: number }): Promise<BookListResponse>;
  getBookById(bookId: string): Promise<Book>;

  // Author - Tickets
  getTickets(filters?: TicketFilter): Promise<TicketListResponse>;
  getTicketById(ticketId: string): Promise<TicketDetailResponse>;
  createTicket(request: CreateTicketRequest): Promise<TicketResponse>;

  // Admin (Contracts defined for seamless integration)
  getAdminTickets(filters?: TicketFilter): Promise<AdminQueueResponse>;
  getAdminTicketById(ticketId: string): Promise<AdminTicketDetailResponse>;
  updateTicket(ticketId: string, request: UpdateTicketRequest): Promise<TicketResponse>;
  replyToTicket(ticketId: string, request: TicketReplyRequest): Promise<TicketMessageResponse>;
  addInternalNote(ticketId: string, request: InternalNoteRequest): Promise<InternalNoteResponse>;
  assignTicket(ticketId: string, request: AssignTicketRequest): Promise<AssignmentResponse>;
  triggerAiAnalysis(ticketId: string): Promise<AiAnalysisRequestResponse>;
  getAiAnalysis(ticketId: string): Promise<AiAnalysisResponse>;
}
