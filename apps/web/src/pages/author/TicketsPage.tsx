import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  LifeBuoy,
  ChevronRight,
  Filter,
  Search,
  RotateCcw,
  ChevronLeft,
  Calendar,
  BookOpen,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import {
  type TicketSummary,
  ticketStatuses,
  ticketCategories,
  ticketPriorities,
} from "@bookleaf/contracts";
import { StatusBadge, Badge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";
import { TableSkeleton } from "../../components/common/Skeleton";
import { EmptyState } from "../../components/common/EmptyState";
import { Alert } from "../../components/common/Alert";
import { ticketEventManager } from "../../api/events";

export const TicketsPage: React.FC = () => {
  const { client } = useAuth();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await client.getTickets({
        page,
        pageSize,
        status: statusFilter ? (statusFilter as any) : undefined,
        category: categoryFilter ? (categoryFilter as any) : undefined,
        priority: priorityFilter ? (priorityFilter as any) : undefined,
      });

      let items = res.items;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        items = items.filter(
          (t) =>
            t.subject.toLowerCase().includes(q) ||
            t.id.toLowerCase().includes(q) ||
            (t.bookId && t.bookId.toLowerCase().includes(q))
        );
      }

      setTickets(items);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message || "Failed to load support tickets");
    } finally {
      setIsLoading(false);
    }
  }, [client, page, pageSize, statusFilter, categoryFilter, priorityFilter, searchQuery]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Live SSE / Polling listener
  useEffect(() => {
    const unsubscribe = ticketEventManager.subscribe((event) => {
      if (
        event.type === "ticket.created" ||
        event.type === "ticket.updated" ||
        event.type === "ticket.reply.created"
      ) {
        loadTickets();
      }
    });
    return unsubscribe;
  }, [loadTickets]);

  const handleResetFilters = () => {
    setStatusFilter("");
    setCategoryFilter("");
    setPriorityFilter("");
    setSearchQuery("");
    setPage(1);
  };

  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-stone-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 font-editorial">
            Author Support Tickets
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            Track inquiries regarding royalties, distribution, typesetting proofs, and account services.
          </p>
        </div>

        <Link to="/tickets/new">
          <Button variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>
            New Support Ticket
          </Button>
        </Link>
      </div>

      {error && (
        <Alert variant="error" title="Tickets Sync Error">
          {error}
        </Alert>
      )}

      {/* Filter and Search Bar */}
      <Card className="p-4 bg-white/80 backdrop-blur-sm shadow-subtle">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search Input */}
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 absolute left-3 top-3 text-stone-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by subject or ticket ID..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-stone-200 bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Status Filter */}
          <div>
            <select
              aria-label="Filter by Status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-2.5 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All Statuses</option>
              {ticketStatuses.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div>
            <select
              aria-label="Filter by Category"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-2.5 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All Categories</option>
              {ticketCategories.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          {/* Priority / Reset */}
          <div className="flex items-center gap-2">
            <select
              aria-label="Filter by Priority"
              value={priorityFilter}
              onChange={(e) => {
                setPriorityFilter(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-2.5 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All Priorities</option>
              {ticketPriorities.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            {(statusFilter || categoryFilter || priorityFilter || searchQuery) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="p-2 text-stone-400 hover:text-stone-700 rounded-lg border border-stone-200 hover:bg-stone-50"
                title="Reset filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Tickets List */}
      {isLoading ? (
        <Card className="p-6">
          <TableSkeleton rows={4} />
        </Card>
      ) : tickets.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy className="w-8 h-8 text-stone-400" />}
          title={
            statusFilter || categoryFilter || priorityFilter || searchQuery
              ? "No tickets match your filters"
              : "No support tickets found"
          }
          description={
            statusFilter || categoryFilter || priorityFilter || searchQuery
              ? "Try adjusting your query or filter parameters to see existing support tickets."
              : "You haven't filed any support inquiries yet. Reach out whenever you need editorial or royalty help."
          }
          action={
            statusFilter || categoryFilter || priorityFilter || searchQuery ? (
              <Button variant="secondary" size="sm" onClick={handleResetFilters}>
                Clear All Filters
              </Button>
            ) : (
              <Link to="/tickets/new">
                <Button variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>
                  Create Ticket
                </Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="space-y-4">
          <Card className="divide-y divide-stone-100 overflow-hidden shadow-card">
            {tickets.map((ticket) => (
              <Link
                key={ticket.id}
                to={`/tickets/${ticket.id}`}
                className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-stone-50 transition-colors group block"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <StatusBadge status={ticket.status} />
                    {ticket.category && (
                      <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-stone-100 text-stone-700 uppercase">
                        {ticket.category.replace(/_/g, " ")}
                      </span>
                    )}
                    {ticket.priority && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded text-stone-500 border border-stone-200">
                        Priority: {ticket.priority}
                      </span>
                    )}
                    {ticket.bookId && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                        <BookOpen className="w-3 h-3" />
                        Book Linked
                      </span>
                    )}
                  </div>

                  <h3 className="font-semibold text-stone-900 text-sm group-hover:text-brand-700 transition-colors">
                    {ticket.subject}
                  </h3>

                  <div className="flex items-center gap-3 text-xs text-stone-400 font-mono">
                    <span>ID: {ticket.id}</span>
                    <span>•</span>
                    <span>
                      Updated: {new Date(ticket.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2 text-stone-400 group-hover:text-stone-700">
                  <span className="text-xs font-medium hidden sm:inline">View Conversation</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </Link>
            ))}
          </Card>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-2 text-xs text-stone-500">
              <span>
                Showing page <strong>{page}</strong> of <strong>{totalPages}</strong> ({total} total tickets)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
