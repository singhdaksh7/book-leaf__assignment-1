import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  User,
  Clock,
  Sparkles,
  AlertTriangle,
  RotateCcw,
  Calendar,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import type { TicketSummary, TicketFilter } from "@bookleaf/contracts";
import { StatusBadge, Badge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { Card } from "../../components/common/Card";
import { TableSkeleton } from "../../components/common/Skeleton";
import { EmptyState } from "../../components/common/EmptyState";
import { Alert } from "../../components/common/Alert";

export const AdminQueuePage: React.FC = () => {
  const { client, user } = useAuth();

  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  useEffect(() => {
    let isMounted = true;
    async function loadQueue() {
      try {
        setIsLoading(true);
        setError(null);
        const filter: TicketFilter = {
          page,
          pageSize,
          status: statusFilter !== "ALL" ? (statusFilter as any) : undefined,
          category: categoryFilter !== "ALL" ? (categoryFilter as any) : undefined,
          priority: priorityFilter !== "ALL" ? (priorityFilter as any) : undefined,
          from: fromDate ? new Date(fromDate) : undefined,
          to: toDate ? new Date(toDate) : undefined,
        };

        const res = await client.getAdminTickets(filter);
        if (isMounted) {
          setTickets(res.items);
          setTotal(res.total);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || "Failed to load admin queue.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadQueue();
    return () => {
      isMounted = false;
    };
  }, [client, page, pageSize, statusFilter, categoryFilter, priorityFilter, fromDate, toDate]);

  // Client search filtering on current page
  const filteredTickets = useMemo(() => {
    if (!searchQuery.trim()) return tickets;
    const q = searchQuery.toLowerCase();
    return tickets.filter(
      (t) =>
        t.subject.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        (t.category && t.category.toLowerCase().includes(q))
    );
  }, [tickets, searchQuery]);

  const handleResetFilters = () => {
    setStatusFilter("ALL");
    setPriorityFilter("ALL");
    setCategoryFilter("ALL");
    setFromDate("");
    setToDate("");
    setSearchQuery("");
    setPage(1);
  };

  const isOldTicket = (createdAt: string, status: string) => {
    if (status === "RESOLVED" || status === "CLOSED") return false;
    const ageHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
    return ageHours > 48;
  };

  const isUrgent = (priority: string | null) => {
    return priority === "CRITICAL" || priority === "HIGH";
  };

  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-stone-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 font-editorial flex items-center gap-2">
            Support Queue
            <span className="text-xs font-mono font-normal bg-stone-100 text-stone-600 px-2 py-0.5 rounded">
              {total} Total Tickets
            </span>
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            Filter, triage, assign, and respond to author inquiries with AI drafting assistance.
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="error" title="Queue Synchronization Issue">
          {error}
        </Alert>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
          <div className="w-full lg:w-72">
            <Input
              id="admin-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search subject or Ticket ID..."
              leftIcon={<Search className="w-4 h-4" />}
            />
          </div>

          <div className="flex items-center gap-3 w-full lg:w-auto flex-wrap text-xs">
            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-stone-500 uppercase tracking-wider">
                Status:
              </span>
              <select
                aria-label="Filter by Status"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="ALL">All Statuses</option>
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="RESOLVED">Resolved</option>
                <option value="CLOSED">Closed</option>
              </select>
            </div>

            {/* Priority Filter */}
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-stone-500 uppercase tracking-wider">
                Priority:
              </span>
              <select
                aria-label="Filter by Priority"
                value={priorityFilter}
                onChange={(e) => {
                  setPriorityFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="ALL">All Priorities</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-stone-500 uppercase tracking-wider">
                Category:
              </span>
              <select
                aria-label="Filter by Category"
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="ALL">All Categories</option>
                <option value="ROYALTY_PAYMENTS">Royalty Payments</option>
                <option value="PRINTING_QUALITY">Printing Quality</option>
                <option value="ISBN_METADATA">ISBN Metadata</option>
                <option value="DISTRIBUTION_AVAILABILITY">Distribution</option>
                <option value="BOOK_STATUS_PRODUCTION">Production Status</option>
                <option value="GENERAL_INQUIRY">General Inquiry</option>
              </select>
            </div>
          </div>
        </div>

        {/* Date Filters & Reset Row */}
        <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-stone-500 uppercase tracking-wider flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              Date Created:
            </span>
            <div className="flex items-center gap-1.5">
              <label htmlFor="filter-from-date" className="text-stone-400">From:</label>
              <input
                id="filter-from-date"
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(1);
                }}
                className="rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-700 bg-white"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label htmlFor="filter-to-date" className="text-stone-400">To:</label>
              <input
                id="filter-to-date"
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(1);
                }}
                className="rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-700 bg-white"
              />
            </div>
          </div>

          {(statusFilter !== "ALL" ||
            priorityFilter !== "ALL" ||
            categoryFilter !== "ALL" ||
            fromDate ||
            toDate ||
            searchQuery) && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900 font-medium"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset All Filters
            </button>
          )}
        </div>
      </div>

      {/* Queue Table */}
      {isLoading ? (
        <Card className="p-6">
          <TableSkeleton rows={6} />
        </Card>
      ) : filteredTickets.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="w-8 h-8 text-stone-400" />}
          title="No tickets match criteria"
          description="There are currently no tickets matching the applied filters."
          action={
            (statusFilter !== "ALL" || priorityFilter !== "ALL" || categoryFilter !== "ALL" || searchQuery || fromDate || toDate) && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetFilters}
              >
                Reset Queue Filters
              </Button>
            )
          }
        />
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-stone-700">
              <thead className="bg-stone-50 border-b border-stone-200 text-xs font-semibold uppercase tracking-wider text-stone-500">
                <tr>
                  <th scope="col" className="px-5 py-3.5">
                    Priority & Status
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Ticket Subject & ID
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Category
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Assignee
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Updated
                  </th>
                  <th scope="col" className="px-5 py-3.5 text-center">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredTickets.map((ticket) => {
                  const urgent = isUrgent(ticket.priority);
                  const old = isOldTicket(ticket.createdAt, ticket.status);

                  return (
                    <tr
                      key={ticket.id}
                      className="hover:bg-stone-50/80 transition-colors group"
                    >
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {ticket.priority ? (
                            <StatusBadge status={ticket.priority} />
                          ) : (
                            <span className="text-xs text-stone-400 font-mono">—</span>
                          )}
                          <StatusBadge status={ticket.status} />
                          {urgent && (
                            <span
                              data-testid="urgent-indicator"
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-300"
                            >
                              <AlertTriangle className="w-3 h-3 text-red-600" />
                              Urgent SLA
                            </span>
                          )}
                          {old && (
                            <span
                              data-testid="old-indicator"
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300"
                            >
                              <Clock className="w-3 h-3 text-amber-600" />
                              Old (&gt;48h)
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-4 min-w-[280px]">
                        <Link
                          to={`/admin/tickets/${ticket.id}`}
                          className="font-semibold text-stone-900 group-hover:text-brand-700 block transition-colors"
                        >
                          {ticket.subject}
                        </Link>
                        <span className="text-xs text-stone-400 font-mono mt-0.5 block">
                          {ticket.id}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-xs font-mono whitespace-nowrap">
                        {ticket.category ? (
                          <span className="bg-stone-100 text-stone-700 px-2 py-0.5 rounded font-medium">
                            {ticket.category.replace(/_/g, " ")}
                          </span>
                        ) : (
                          <span className="text-stone-400">Unclassified</span>
                        )}
                      </td>

                      <td className="px-4 py-4 text-xs whitespace-nowrap">
                        {ticket.assigneeId === user?.id ? (
                          <span className="font-semibold text-emerald-700 flex items-center gap-1">
                            <User className="w-3.5 h-3.5" />
                            Assigned to You
                          </span>
                        ) : ticket.assigneeId ? (
                          <span className="text-stone-600 font-mono">
                            Staff ({ticket.assigneeId})
                          </span>
                        ) : (
                          <span className="text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded">
                            Unassigned
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-4 text-xs text-stone-500 font-mono whitespace-nowrap">
                        {new Date(ticket.updatedAt).toLocaleDateString()}
                      </td>

                      <td className="px-5 py-4 text-center whitespace-nowrap">
                        <Link to={`/admin/tickets/${ticket.id}`}>
                          <Button variant="outline" size="sm" className="text-xs">
                            Triage & Reply
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-stone-500 px-1">
          <span>
            Showing page <strong>{page}</strong> of <strong>{totalPages}</strong> ({total} total tickets)
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
            >
              Previous
            </Button>
            <Button
              variant="outline"
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
  );
};
