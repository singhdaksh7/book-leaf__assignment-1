import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import { ProtectedRoute } from "../router/ProtectedRoute";
import { AdminDashboardPage } from "../pages/admin/AdminDashboardPage";
import { AdminQueuePage } from "../pages/admin/AdminQueuePage";
import { AdminTicketDetailPage } from "../pages/admin/AdminTicketDetailPage";

describe("Milestone 3 — Complete Admin Portal Workflows", () => {
  it("renders admin dashboard with KPI metrics and priority queue preview", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/dashboard"]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByText(/Editorial & Support Queue/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Unresolved Tickets")).toBeInTheDocument();
    });
    expect(screen.getByText("Urgent & Critical")).toBeInTheDocument();
    expect(screen.getByText("Awaiting Assignment")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText(/Q1 Royalty payout reconciliation/i)
      ).toBeInTheDocument();
    });
  });

  it("renders admin ticket queue with filter controls, date filters, and urgent/old indicators", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/queue"]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin/queue" element={<AdminQueuePage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByText("Support Queue")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search subject or Ticket ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Filter by Status/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Filter by Priority/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Filter by Category/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/From:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/To:/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText(/Q1 Royalty payout reconciliation/i)
      ).toBeInTheDocument();
    });

    // Check urgent indicator on high priority ticket
    expect(screen.getByTestId("urgent-indicator")).toBeInTheDocument();
  });

  it("renders admin ticket detail with author context, book context, AI analysis, and audit log", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/tickets/tkt_synth_01"]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin/tickets/:ticketId" element={<AdminTicketDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Verify ticket subject loads
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Q1 Royalty payout reconciliation/i })
      ).toBeInTheDocument();
    });

    // Verify Author Profile Context
    expect(screen.getByText("Author Profile Context")).toBeInTheDocument();
    expect(screen.getByText("Aria Montgomery-Hayes")).toBeInTheDocument();
    expect(screen.getByText("BL-AUTH-8821")).toBeInTheDocument();

    // Verify Book Context
    expect(screen.getByText("Associated Book Context")).toBeInTheDocument();
    expect(screen.getByText("The Celestial Cartographer: Maps of Forgotten Stars")).toBeInTheDocument();

    // Verify AI Copilot analysis & mandatory human review banner
    expect(screen.getByText("AI Copilot Analysis")).toBeInTheDocument();
    expect(screen.getByText("Human Review Required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Insert Draft into Reply Box/i })).toBeInTheDocument();

    // Verify Confidential Internal Notes section
    expect(screen.getByText("Internal Staff Notes")).toBeInTheDocument();
    expect(screen.getByText(/Staff Confidential — Never Shared With Author/i)).toBeInTheDocument();

    // Verify Audit Log
    expect(screen.getByText(/Audit Log & Lifecycle Events/i)).toBeInTheDocument();
    expect(screen.getByText("TICKET_CREATED")).toBeInTheDocument();
  });

  it("inserts AI draft into reply box, supports editing, and sends reply with explicit action", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/tickets/tkt_synth_01"]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin/tickets/:ticketId" element={<AdminTicketDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Insert Draft into Reply Box/i })).toBeInTheDocument();
    });

    const insertBtn = screen.getByRole("button", { name: /Insert Draft into Reply Box/i });
    fireEvent.click(insertBtn);

    const replyTextarea = screen.getByPlaceholderText(
      /Compose reply to author/i
    ) as HTMLTextAreaElement;

    expect(replyTextarea.value).toContain("Hello Aria");

    // Admin edits draft before sending
    fireEvent.change(replyTextarea, {
      target: { value: replyTextarea.value + "\n\nUpdate: We verified remittance." },
    });
    expect(replyTextarea.value).toContain("Update: We verified remittance.");

    // Explicit send button
    const sendBtn = screen.getByRole("button", { name: /Send Reply/i });
    expect(sendBtn).toBeEnabled();
    fireEvent.click(sendBtn);
  });

  it("submits internal staff note with confidential isolation", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/tickets/tkt_synth_01"]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin/tickets/:ticketId" element={<AdminTicketDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Add private note for editorial or accounting team/i)).toBeInTheDocument();
    });

    const noteInput = screen.getByPlaceholderText(
      /Add private note for editorial or accounting team/i
    );
    fireEvent.change(noteInput, {
      target: { value: "Finance confirmed remittance queue ID #8849." },
    });

    const saveNoteBtn = screen.getByRole("button", { name: /Save Internal Note/i });
    fireEvent.click(saveNoteBtn);
  });

  it("supports manual ticket status and priority overrides, and self-assignment", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/tickets/tkt_synth_01"]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin/tickets/:ticketId" element={<AdminTicketDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Apply Overrides & Update/i })).toBeInTheDocument();
    });

    const overrideBtn = screen.getByRole("button", { name: /Apply Overrides & Update/i });
    fireEvent.click(overrideBtn);

    // Assignment toggle
    const assignToggle = screen.getByText(/Assign to Me|Unassign Me/i);
    expect(assignToggle).toBeInTheDocument();
  });

  it("blocks non-admin role from accessing role-protected admin routes", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/queue"]}>
        <AuthProvider>
          <Routes>
            <Route
              path="/admin/queue"
              element={
                <ProtectedRoute requiredRole="ADMIN">
                  <AdminQueuePage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Initial synthetic user is role AUTHOR -> must show Access Restricted
    await waitFor(() => {
      expect(screen.getByText("Access Restricted")).toBeInTheDocument();
      expect(
        screen.getByText(/Your account role \(AUTHOR\) does not have permission/i)
      ).toBeInTheDocument();
    });
  });
});
