import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import { TicketsPage } from "../pages/author/TicketsPage";
import { NewTicketPage } from "../pages/author/NewTicketPage";
import { TicketDetailPage } from "../pages/author/TicketDetailPage";
import { ticketEventManager } from "../api/events";

describe("Milestone 2 — Author Support Ticket Flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders author ticket list with items, status badges, and filter controls", async () => {
    render(
      <MemoryRouter initialEntries={["/tickets"]}>
        <AuthProvider>
          <Routes>
            <Route path="/tickets" element={<TicketsPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByText("Author Support Tickets")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Search by subject or ticket ID/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Filter by Status/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Filter by Category/i)).toBeInTheDocument();

    // Verify synthetic tickets load
    await waitFor(() => {
      expect(
        screen.getByText(/Q1 Royalty payout reconciliation/i)
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Typesetting proof verification/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Updated tax declaration/i)
    ).toBeInTheDocument();
  });

  it("filters tickets by search query in the list", async () => {
    render(
      <MemoryRouter initialEntries={["/tickets"]}>
        <AuthProvider>
          <Routes>
            <Route path="/tickets" element={<TicketsPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Q1 Royalty payout reconciliation/i)
      ).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(
      /Search by subject or ticket ID/i
    );
    fireEvent.change(searchInput, { target: { value: "Royalty" } });

    await waitFor(() => {
      expect(
        screen.getByText(/Q1 Royalty payout reconciliation/i)
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Typesetting proof verification/i)
      ).not.toBeInTheDocument();
    });
  });

  it("validates subject and description constraints in NewTicketPage", async () => {
    render(
      <MemoryRouter initialEntries={["/tickets/new"]}>
        <AuthProvider>
          <Routes>
            <Route path="/tickets/new" element={<NewTicketPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByText("Create New Support Ticket")).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: /Submit Ticket/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Subject must be at least 3 characters long/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Description must provide at least 10 characters/i)
      ).toBeInTheDocument();
    });
  });

  it("preselects associated book from query parameter in NewTicketPage", async () => {
    render(
      <MemoryRouter initialEntries={["/tickets/new?bookId=bk_synth_001"]}>
        <AuthProvider>
          <Routes>
            <Route path="/tickets/new" element={<NewTicketPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      const select = screen.getByLabelText(/Associated Title/i) as HTMLSelectElement;
      expect(select.value).toBe("bk_synth_001");
    });
  });

  it("submits a valid ticket successfully and handles duplicate click protection", async () => {
    render(
      <MemoryRouter initialEntries={["/tickets/new"]}>
        <AuthProvider>
          <Routes>
            <Route path="/tickets/new" element={<NewTicketPage />} />
            <Route
              path="/tickets/:ticketId"
              element={<div data-testid="ticket-detail-view">Ticket Detail View</div>}
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    const subjectInput = screen.getByLabelText(/Subject Summary/i);
    const descInput = screen.getByLabelText(/Detailed Description/i);
    const submitBtn = screen.getByRole("button", { name: /Submit Ticket/i });

    fireEvent.change(subjectInput, {
      target: { value: "Inquiry on distribution rights in UK" },
    });
    fireEvent.change(descInput, {
      target: {
        value: "Please clarify wholesale print catalog listings for Waterstones UK stores.",
      },
    });

    // Rapid double click to test submission protection
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("ticket-detail-view")).toBeInTheDocument();
    });
  });

  it("renders ticket detail with initial description, author conversation, and strictly NO internal notes or AI drafts", async () => {
    render(
      <MemoryRouter initialEntries={["/tickets/tkt_synth_01"]}>
        <AuthProvider>
          <Routes>
            <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Verify ticket subject loads
    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: /Q1 Royalty payout reconciliation/i,
        })
      ).toBeInTheDocument();
    });

    // Verify initial description
    expect(
      screen.getAllByText(/pending royalty balance of INR 21,500/i).length
    ).toBeGreaterThan(0);

    // Verify author and staff message thread
    expect(
      screen.getByText(/Author & Editorial Conversation/i)
    ).toBeInTheDocument();

    // SECURITY CHECK:
    // Internal note "IngramSpark payout confirmation received from accounts team" MUST NOT appear
    expect(
      screen.queryByText(/IngramSpark payout confirmation received from accounts team/i)
    ).not.toBeInTheDocument();

    // AI copilot analysis panel MUST NOT appear in author view
    expect(screen.queryByText(/AI Copilot Analysis/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Staff Confidential — Never Shared With Author/i)
    ).not.toBeInTheDocument();
  });

  it("subscribes to ticket events and triggers reload on SSE updates", async () => {
    const notifySpy = vi.spyOn(ticketEventManager, "subscribe");

    render(
      <MemoryRouter initialEntries={["/tickets/tkt_synth_01"]}>
        <AuthProvider>
          <Routes>
            <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(notifySpy).toHaveBeenCalled();
    });
  });
});
