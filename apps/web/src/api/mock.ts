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
  CurrentUser,
  Ticket,
  AuthorTicketMessage,
  TicketMessage,
  InternalNote,
  TicketAssignment,
  AuditEvent,
  AiAnalysisAttempt,
} from "@bookleaf/contracts";
import { type ApiClient, ApiClientError } from "./client";

const SYNTHETIC_AUTHOR_USER: CurrentUser = {
  id: "usr_auth_01",
  email: "author@bookleafpublishing.test",
  role: "AUTHOR",
  authorProfile: {
    id: "auth_prof_01",
    userId: "usr_auth_01",
    externalAuthorId: "BL-AUTH-8821",
    name: "Aria Montgomery-Hayes",
    phone: "+1 (555) 019-2834",
    city: "Cambridge, MA",
    joinedDate: "2023-04-15",
  },
};

const SYNTHETIC_ADMIN_USER: CurrentUser = {
  id: "usr_admin_01",
  email: "editorial.admin@bookleafpublishing.test",
  role: "ADMIN",
  authorProfile: null,
};

const INITIAL_BOOKS: Book[] = [
  {
    id: "bk_synth_001",
    externalBookId: "BL-BK-10492",
    authorId: "auth_prof_01",
    title: "The Celestial Cartographer: Maps of Forgotten Stars",
    isbn: "978-1-60309-502-0",
    genre: "Speculative Fiction",
    publicationDate: "2023-09-12",
    status: "PUBLISHED",
    mrp: 499,
    authorRoyaltyPerCopy: 75,
    totalCopiesSold: 1420,
    totalRoyaltyEarned: 106500,
    royaltyPaid: 85000,
    royaltyPending: 21500,
    lastRoyaltyPayoutDate: "2024-03-31",
    printPartner: "Lightning Source UK",
    availableOn: ["Amazon", "Kindle Direct", "Barnes & Noble", "BookLeaf Store", "IngramSpark"],
  },
  {
    id: "bk_synth_002",
    externalBookId: "BL-BK-20311",
    authorId: "auth_prof_01",
    title: "Whispers Beneath the Banyan: Collected Prose & Reflections",
    isbn: "978-0-14-345001-9",
    genre: "Literary Non-Fiction",
    publicationDate: "2024-01-20",
    status: "PUBLISHED",
    mrp: 350,
    authorRoyaltyPerCopy: 50,
    totalCopiesSold: 680,
    totalRoyaltyEarned: 34000,
    royaltyPaid: 34000,
    royaltyPending: 0,
    lastRoyaltyPayoutDate: "2024-03-31",
    printPartner: "Repro India",
    availableOn: ["Amazon", "Flipkart", "BookLeaf Store"],
  },
  {
    id: "bk_synth_003",
    externalBookId: "BL-BK-33980",
    authorId: "auth_prof_01",
    title: "Chronicles of the Veridian Sea",
    isbn: "978-93-89053-11-4",
    genre: "High Fantasy",
    publicationDate: "2024-05-10",
    status: "IN_REVIEW",
    mrp: 599,
    authorRoyaltyPerCopy: 90,
    totalCopiesSold: 110,
    totalRoyaltyEarned: 9900,
    royaltyPaid: 0,
    royaltyPending: 9900,
    lastRoyaltyPayoutDate: null,
    printPartner: "Repro India",
    availableOn: ["BookLeaf Store", "Amazon Pre-order"],
  },
  {
    id: "bk_synth_004",
    externalBookId: "BL-BK-40912",
    authorId: "auth_prof_01",
    title: "The Midnight Arboretum: An Anthology",
    isbn: "978-0-06-297740-3",
    genre: "Poetry",
    publicationDate: null,
    status: "DRAFT_TYPESETTING",
    mrp: null,
    authorRoyaltyPerCopy: null,
    totalCopiesSold: 0,
    totalRoyaltyEarned: 0,
    royaltyPaid: 0,
    royaltyPending: 0,
    lastRoyaltyPayoutDate: null,
    printPartner: null,
    availableOn: [],
  },
];

const INITIAL_TICKETS: Ticket[] = [
  {
    id: "tkt_synth_01",
    authorId: "auth_prof_01",
    bookId: "bk_synth_001",
    subject: "Q1 Royalty payout reconciliation for Celestial Cartographer international sales",
    status: "IN_PROGRESS",
    category: "ROYALTY_PAYMENTS",
    priority: "HIGH",
    assigneeId: "usr_admin_01",
    description: "I noticed the pending royalty balance of INR 21,500 from international print distributor IngramSpark hasn't cleared into the direct deposit yet. Could the finance team check the remittance cycle?",
    createdAt: "2024-04-02T10:30:00Z",
    updatedAt: "2024-04-03T14:15:00Z",
  },
  {
    id: "tkt_synth_02",
    authorId: "auth_prof_01",
    bookId: "bk_synth_003",
    subject: "Typesetting proof verification for Chapter 4 map illustrations",
    status: "OPEN",
    category: "PRINTING_QUALITY",
    priority: "MEDIUM",
    assigneeId: null,
    description: "The high-resolution monochrome raster map on page 84 in the latest PDF proof seems slightly soft around coastal labels. Is the 300 DPI vector embed preserved?",
    createdAt: "2024-05-12T09:00:00Z",
    updatedAt: "2024-05-12T09:00:00Z",
  },
  {
    id: "tkt_synth_03",
    authorId: "auth_prof_01",
    bookId: null,
    subject: "Updated tax declaration and postal address for TDS certificates",
    status: "RESOLVED",
    category: "GENERAL_INQUIRY",
    priority: "LOW",
    assigneeId: "usr_admin_01",
    description: "I have updated my residency address for annual tax reporting. Please confirm our records match the Cambridge address.",
    createdAt: "2024-03-10T11:20:00Z",
    updatedAt: "2024-03-14T16:45:00Z",
  },
];

const INITIAL_MESSAGES: Record<string, AuthorTicketMessage[]> = {
  tkt_synth_01: [
    {
      id: "msg_01",
      ticketId: "tkt_synth_01",
      authorId: "usr_auth_01",
      body: "I noticed the pending royalty balance of INR 21,500 from international print distributor IngramSpark hasn't cleared into the direct deposit yet. Could the finance team check the remittance cycle?",
      visibility: "AUTHOR",
      createdAt: "2024-04-02T10:30:00Z",
    },
    {
      id: "msg_02",
      ticketId: "tkt_synth_01",
      authorId: "usr_admin_01",
      body: "Hello Aria, thank you for reaching out. We pulled the Q1 distributor ledger. International remittance batches are finalized on the 15th of the month following quarter close. We have flagged this ticket to monitor until the settlement clears.",
      visibility: "AUTHOR",
      createdAt: "2024-04-03T11:20:00Z",
    },
    {
      id: "msg_03",
      ticketId: "tkt_synth_01",
      authorId: "usr_auth_01",
      body: "Thank you for the quick clarification! I'll look out for the direct deposit around the 15th.",
      visibility: "AUTHOR",
      createdAt: "2024-04-03T14:15:00Z",
    },
  ],
  tkt_synth_02: [
    {
      id: "msg_04",
      ticketId: "tkt_synth_02",
      authorId: "usr_auth_01",
      body: "The high-resolution monochrome raster map on page 84 in the latest PDF proof seems slightly soft around coastal labels. Is the 300 DPI vector embed preserved?",
      visibility: "AUTHOR",
      createdAt: "2024-05-12T09:00:00Z",
    },
  ],
  tkt_synth_03: [
    {
      id: "msg_05",
      ticketId: "tkt_synth_03",
      authorId: "usr_auth_01",
      body: "I have updated my residency address for annual tax reporting. Please confirm our records match the Cambridge address.",
      visibility: "AUTHOR",
      createdAt: "2024-03-10T11:20:00Z",
    },
    {
      id: "msg_06",
      ticketId: "tkt_synth_03",
      authorId: "usr_admin_01",
      body: "Confirmed! Your publisher tax file and Form 16/TDS dispatch address has been synced with the Cambridge profile. Closing this ticket as resolved.",
      visibility: "AUTHOR",
      createdAt: "2024-03-14T16:45:00Z",
    },
  ],
};

function delay(ms = 180): Promise<void> {
  if (typeof process !== "undefined" && (process.env?.NODE_ENV === "test" || process.env?.VITEST)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockApiClient implements ApiClient {
  public readonly isMock = true;

  private currentUser: CurrentUser | null = SYNTHETIC_AUTHOR_USER;
  private books: Book[] = [...INITIAL_BOOKS];
  private tickets: Ticket[] = [...INITIAL_TICKETS];
  private messages: Record<string, AuthorTicketMessage[]> = { ...INITIAL_MESSAGES };
  private internalNotes: Record<string, InternalNote[]> = {
    tkt_synth_01: [
      {
        id: "note_01",
        ticketId: "tkt_synth_01",
        authorId: "usr_admin_01",
        body: "IngramSpark payout confirmation received from accounts team. Remittance scheduled for April 15th.",
        createdAt: "2024-04-03T11:15:00Z",
      },
    ],
  };
  private assignments: Record<string, TicketAssignment[]> = {
    tkt_synth_01: [
      {
        id: "asgn_01",
        ticketId: "tkt_synth_01",
        assigneeId: "usr_admin_01",
        assignedById: "usr_admin_01",
        createdAt: "2024-04-02T11:00:00Z",
      },
    ],
  };

  // Auth
  async login(request: LoginRequest): Promise<LoginResponse> {
    await delay(250);
    if (request.email.toLowerCase().includes("admin")) {
      this.currentUser = SYNTHETIC_ADMIN_USER;
    } else {
      this.currentUser = {
        ...SYNTHETIC_AUTHOR_USER,
        email: request.email,
      };
    }
    return { user: this.currentUser };
  }

  async logout(): Promise<void> {
    await delay(150);
    this.currentUser = null;
  }

  async getCurrentUser(): Promise<MeResponse> {
    await delay(120);
    if (!this.currentUser) {
      throw new ApiClientError("UNAUTHENTICATED", "No active session found", 401);
    }
    return { user: this.currentUser };
  }

  // Author - Books
  async getBooks(params?: { page?: number; pageSize?: number }): Promise<BookListResponse> {
    await delay(200);
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 25;
    const start = (page - 1) * pageSize;
    const paginated = this.books.slice(start, start + pageSize);

    return {
      items: paginated,
      page,
      pageSize,
      total: this.books.length,
    };
  }

  async getBookById(bookId: string): Promise<Book> {
    await delay(180);
    const book = this.books.find((b) => b.id === bookId || b.externalBookId === bookId);
    if (!book) {
      throw new ApiClientError("NOT_FOUND", `Book with ID "${bookId}" was not found`, 404);
    }
    return book;
  }

  // Author - Tickets
  async getTickets(filters?: TicketFilter): Promise<TicketListResponse> {
    await delay(200);
    let filtered = [...this.tickets];

    if (filters?.status) {
      filtered = filtered.filter((t) => t.status === filters.status);
    }
    if (filters?.category) {
      filtered = filtered.filter((t) => t.category === filters.category);
    }
    if (filters?.priority) {
      filtered = filtered.filter((t) => t.priority === filters.priority);
    }

    const page = filters?.page || 1;
    const pageSize = filters?.pageSize || 25;
    const start = (page - 1) * pageSize;

    return {
      items: filtered.slice(start, start + pageSize),
      page,
      pageSize,
      total: filtered.length,
    };
  }

  async getTicketById(ticketId: string): Promise<TicketDetailResponse> {
    await delay(200);
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      throw new ApiClientError("NOT_FOUND", `Ticket with ID "${ticketId}" was not found`, 404);
    }
    const messages = this.messages[ticketId] || [];
    return { ticket, messages };
  }

  async createTicket(request: CreateTicketRequest): Promise<TicketResponse> {
    await delay(300);
    const newId = `tkt_synth_${Date.now()}`;
    const now = new Date().toISOString();

    const newTicket: Ticket = {
      id: newId,
      authorId: this.currentUser?.authorProfile?.id || "auth_prof_01",
      bookId: request.bookId,
      subject: request.subject,
      status: "OPEN",
      category: null,
      priority: null,
      assigneeId: null,
      description: request.description,
      createdAt: now,
      updatedAt: now,
    };

    this.tickets.unshift(newTicket);

    const initialMessage: AuthorTicketMessage = {
      id: `msg_${Date.now()}`,
      ticketId: newId,
      authorId: this.currentUser?.id || "usr_auth_01",
      body: request.description,
      visibility: "AUTHOR",
      createdAt: now,
    };

    this.messages[newId] = [initialMessage];

    return { ticket: newTicket };
  }

  // Admin
  async getAdminTickets(filters?: TicketFilter): Promise<AdminQueueResponse> {
    return this.getTickets(filters);
  }

  async getAdminTicketById(ticketId: string): Promise<AdminTicketDetailResponse> {
    await delay(220);
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      throw new ApiClientError("NOT_FOUND", `Ticket with ID "${ticketId}" was not found`, 404);
    }

    const book = ticket.bookId ? this.books.find((b) => b.id === ticket.bookId) || null : null;
    const author = SYNTHETIC_AUTHOR_USER.authorProfile!;
    const messages: TicketMessage[] = this.messages[ticketId] || [];
    const notes = this.internalNotes[ticketId] || [];
    const assignments = this.assignments[ticketId] || [];

    const aiAnalysis: AiAnalysisAttempt = {
      id: `ai_atm_${ticketId}`,
      ticketId,
      status: "COMPLETED",
      errorCode: null,
      analysis: {
        category: (ticket.category as any) || "GENERAL_INQUIRY",
        priority: (ticket.priority as any) || "MEDIUM",
        confidence: 0.88,
        rationale: "Analysis indicates inquiry regarding publication status and accounting reconciliation.",
        draftResponse: `Hello ${author.name.split(" ")[0]}, thank you for writing in regarding ${ticket.subject}. Our editorial production team is reviewing your record.`,
        requiresHumanReview: true,
        knowledgeBaseCitations: ["kb_royalty_policy_section_3"],
      },
      createdAt: ticket.createdAt,
    };

    const auditEvents: AuditEvent[] = [
      {
        id: `aud_${Date.now()}`,
        actorId: this.currentUser?.id || null,
        action: "TICKET_CREATED",
        entityType: "TICKET",
        entityId: ticketId,
        requestId: null,
        createdAt: ticket.createdAt,
      },
    ];

    return {
      ticket,
      author,
      book,
      messages,
      internalNotes: notes,
      assignments,
      aiAnalysis,
      auditEvents,
    };
  }

  async updateTicket(ticketId: string, request: UpdateTicketRequest): Promise<TicketResponse> {
    await delay(200);
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      throw new ApiClientError("NOT_FOUND", `Ticket with ID "${ticketId}" was not found`, 404);
    }
    if (request.status) ticket.status = request.status;
    if (request.category) ticket.category = request.category;
    if (request.priority) ticket.priority = request.priority;
    ticket.updatedAt = new Date().toISOString();

    return { ticket };
  }

  async replyToTicket(ticketId: string, request: TicketReplyRequest): Promise<TicketMessageResponse> {
    await delay(250);
    const msg: AuthorTicketMessage = {
      id: `msg_${Date.now()}`,
      ticketId,
      authorId: this.currentUser?.id || "usr_admin_01",
      body: request.body,
      visibility: "AUTHOR",
      createdAt: new Date().toISOString(),
    };

    if (!this.messages[ticketId]) {
      this.messages[ticketId] = [];
    }
    this.messages[ticketId].push(msg);

    return { message: msg };
  }

  async addInternalNote(ticketId: string, request: InternalNoteRequest): Promise<InternalNoteResponse> {
    await delay(200);
    const note: InternalNote = {
      id: `note_${Date.now()}`,
      ticketId,
      authorId: this.currentUser?.id || "usr_admin_01",
      body: request.body,
      createdAt: new Date().toISOString(),
    };

    if (!this.internalNotes[ticketId]) {
      this.internalNotes[ticketId] = [];
    }
    this.internalNotes[ticketId].push(note);

    return { note };
  }

  async assignTicket(ticketId: string, request: AssignTicketRequest): Promise<AssignmentResponse> {
    await delay(200);
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      throw new ApiClientError("NOT_FOUND", `Ticket with ID "${ticketId}" was not found`, 404);
    }
    ticket.assigneeId = request.assigneeId;
    ticket.updatedAt = new Date().toISOString();

    const assignment: TicketAssignment = {
      id: `asgn_${Date.now()}`,
      ticketId,
      assigneeId: request.assigneeId,
      assignedById: this.currentUser?.id || "usr_admin_01",
      createdAt: new Date().toISOString(),
    };

    if (!this.assignments[ticketId]) {
      this.assignments[ticketId] = [];
    }
    this.assignments[ticketId].push(assignment);

    return { ticket, assignment };
  }

  async triggerAiAnalysis(ticketId: string): Promise<AiAnalysisRequestResponse> {
    await delay(300);
    const attempt: AiAnalysisAttempt = {
      id: `ai_atm_${Date.now()}`,
      ticketId,
      status: "COMPLETED",
      errorCode: null,
      analysis: {
        category: "ROYALTY_PAYMENTS",
        priority: "HIGH",
        confidence: 0.92,
        rationale: "Detected payout reconciliation query with exact currency mention.",
        draftResponse: "Hello Aria, we have verified your Q1 ledger with finance.",
        requiresHumanReview: true,
        knowledgeBaseCitations: ["kb_royalty_sla_q1"],
      },
      createdAt: new Date().toISOString(),
    };

    return { analysis: attempt };
  }

  async getAiAnalysis(ticketId: string): Promise<AiAnalysisResponse> {
    await delay(150);
    return {
      analysis: {
        id: `ai_atm_${ticketId}`,
        ticketId,
        status: "COMPLETED",
        errorCode: null,
        analysis: {
          category: "ROYALTY_PAYMENTS",
          priority: "HIGH",
          confidence: 0.92,
          rationale: "Detected payout reconciliation query with exact currency mention.",
          draftResponse: "Hello Aria, we have verified your Q1 ledger with finance.",
          requiresHumanReview: true,
          knowledgeBaseCitations: ["kb_royalty_sla_q1"],
        },
        createdAt: new Date().toISOString(),
      },
    };
  }
}
