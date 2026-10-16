import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import { AdminDashboardPage } from "../pages/admin/AdminDashboardPage";
import { DashboardPage } from "../pages/author/DashboardPage";
import type { TicketFilter, TicketSummary } from "@bookleaf/contracts";

/**
 * Regression (BUG-004): dashboard KPIs were computed from a single page of results (50 admin tickets, 25 author tickets), so a
 * deployment with more tickets silently under-counted ("50 unresolved" when 120 were). These tests serve MORE tickets than the
 * old page size, honouring the real API's pagination (max pageSize 100) and `status` filter, and assert the true counts.
 */
const ADMIN_ID = "usr_admin_t";
const ts = "2026-01-01T00:00:00.000Z";
const ticket = (i: number, over: Partial<TicketSummary> = {}): TicketSummary => ({
  id: `tkt_${i}`, authorId: "auth_1", bookId: null, subject: `Subject ${i}`, status: "OPEN", category: null, priority: null,
  assigneeId: null, createdAt: ts, updatedAt: ts, ...over
} as TicketSummary);

/** Mimics the real list endpoints: filters, page/pageSize (max 100), `total` = all matches. */
function paged(all: TicketSummary[], f: Partial<TicketFilter> = {}) {
  const pageSize = Math.min(f.pageSize ?? 25, 100), page = f.page ?? 1;
  const rows = all.filter((t) => (f.status ? t.status === f.status : true));
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: rows.length };
}

const statCard = (title: string) => screen.getByText(title).closest("div")!.parentElement as HTMLElement;

describe("dashboard KPIs use real totals, not one page", () => {
  it("admin dashboard counts every unresolved ticket (120 open, 10 closed, 20 assigned to me)", async () => {
    const all: TicketSummary[] = [
      ...Array.from({ length: 120 }, (_, i) => ticket(i, { priority: i < 15 ? "HIGH" : null, assigneeId: i < 20 ? ADMIN_ID : null })),
      ...Array.from({ length: 10 }, (_, i) => ticket(1000 + i, { status: "CLOSED" }))
    ];
    const client: any = {
      isMock: false,
      getCurrentUser: async () => ({ user: { id: ADMIN_ID, email: "a@example.test", role: "ADMIN", authorProfile: null } }),
      getAdminTickets: async (f: TicketFilter) => paged(all, f)
    };
    render(
      <MemoryRouter initialEntries={["/admin/dashboard"]}>
        <AuthProvider initialClient={client}>
          <Routes><Route path="/admin/dashboard" element={<AdminDashboardPage />} /></Routes>
        </AuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(within(statCard("Unresolved Tickets")).getByText("120")).toBeInTheDocument());
    expect(within(statCard("Awaiting Assignment")).getByText("100")).toBeInTheDocument();
    expect(within(statCard("Assigned to Me")).getByText("20")).toBeInTheDocument();
    expect(within(statCard("Urgent & Critical")).getByText("15")).toBeInTheDocument();
  });

  it("author dashboard counts every active ticket, not only the 25 most recent (60 open + 8 in progress + 4 closed)", async () => {
    const all: TicketSummary[] = [
      ...Array.from({ length: 60 }, (_, i) => ticket(i)),
      ...Array.from({ length: 8 }, (_, i) => ticket(100 + i, { status: "IN_PROGRESS" })),
      ...Array.from({ length: 4 }, (_, i) => ticket(200 + i, { status: "CLOSED" }))
    ].reverse();
    const client: any = {
      isMock: false,
      getCurrentUser: async () => ({ user: { id: "usr_a", email: "x@example.test", role: "AUTHOR", authorProfile: { id: "auth_1", userId: "usr_a", externalAuthorId: "A1", name: "Synthetic Author", phone: "", city: "", joinedDate: "2026-01-01" } } }),
      getBooks: async () => ({ items: [], page: 1, pageSize: 50, total: 0 }),
      getTickets: async (f: TicketFilter) => paged(all, f)
    };
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AuthProvider initialClient={client}>
          <Routes><Route path="/dashboard" element={<DashboardPage />} /></Routes>
        </AuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText(/68 active support inquir/i)).toBeInTheDocument());
  });
});
