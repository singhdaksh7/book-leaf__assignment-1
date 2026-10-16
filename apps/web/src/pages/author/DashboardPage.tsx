import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  DollarSign,
  TrendingUp,
  LifeBuoy,
  Clock,
  ArrowRight,
  Plus,
  Building,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import type { Book, TicketSummary } from "@bookleaf/contracts";
import { StatCard } from "../../components/common/StatCard";
import { Card, CardHeader, CardContent } from "../../components/common/Card";
import { StatusBadge, Badge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { Skeleton, CardSkeleton } from "../../components/common/Skeleton";
import { Alert } from "../../components/common/Alert";

export const DashboardPage: React.FC = () => {
  const { client, user } = useAuth();

  const [books, setBooks] = useState<Book[]>([]);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Real totals from the API; the list above is only the 25 most recent tickets.
  const [activeTotal, setActiveTotal] = useState<number | null>(null);
  const [ticketTotal, setTicketTotal] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadDashboardData() {
      try {
        setIsLoading(true);
        setError(null);
        const [booksRes, ticketsRes, openRes, inProgressRes] = await Promise.all([
          client.getBooks({ page: 1, pageSize: 50 }),
          client.getTickets({ page: 1, pageSize: 25 }),
          client.getTickets({ page: 1, pageSize: 1, status: "OPEN" }),
          client.getTickets({ page: 1, pageSize: 1, status: "IN_PROGRESS" }),
        ]);

        if (isMounted) {
          setBooks(booksRes.items);
          setTickets(ticketsRes.items);
          setTicketTotal(ticketsRes.total);
          setActiveTotal(openRes.total + inProgressRes.total);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || "Failed to load dashboard metrics");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadDashboardData();
    return () => {
      isMounted = false;
    };
  }, [client]);

  // Aggregate financial and inventory metrics across author's books
  const metrics = useMemo(() => {
    let totalCopies = 0;
    let totalRoyalty = 0;
    let royaltyPending = 0;
    let royaltyPaid = 0;

    for (const b of books) {
      totalCopies += b.totalCopiesSold || 0;
      totalRoyalty += b.totalRoyaltyEarned || 0;
      royaltyPending += b.royaltyPending || 0;
      royaltyPaid += b.royaltyPaid || 0;
    }

    const activeTickets = tickets.filter(
      (t) => t.status === "OPEN" || t.status === "IN_PROGRESS"
    );

    return {
      bookCount: books.length,
      totalCopies,
      totalRoyalty,
      royaltyPending,
      royaltyPaid,
      activeTicketsCount: activeTotal ?? activeTickets.length,
    };
  }, [books, tickets, activeTotal]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatNumber = (val: number) => {
    return new Intl.NumberFormat("en-US").format(val);
  };

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-stone-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 font-editorial">
            Author Overview
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            Tracking your titles, distributor sales, and communications with BookLeaf editorial.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/tickets/new">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Open Ticket
            </Button>
          </Link>
          <Link to="/books">
            <Button variant="outline" size="sm">
              View Catalog
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <Alert variant="error" title="Dashboard Synchronization Error">
          {error}
        </Alert>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              title="Published Titles"
              value={metrics.bookCount}
              subtitle="Titles in circulation & review"
              icon={<BookOpen className="w-5 h-5 text-emerald-700" />}
              accentColor="emerald"
            />
            <StatCard
              title="Lifetime Copies Sold"
              value={formatNumber(metrics.totalCopies)}
              subtitle="Across print & digital channels"
              icon={<TrendingUp className="w-5 h-5 text-sky-700" />}
              accentColor="sky"
            />
            <StatCard
              title="Total Royalty Accrued"
              value={formatCurrency(metrics.totalRoyalty)}
              subtitle={`Disbursed: ${formatCurrency(metrics.royaltyPaid)}`}
              icon={<DollarSign className="w-5 h-5 text-brand-700" />}
              accentColor="indigo"
            />
            <StatCard
              title="Pending Settlement"
              value={formatCurrency(metrics.royaltyPending)}
              subtitle={`${metrics.activeTicketsCount} active support inquiry`}
              icon={<Clock className="w-5 h-5 text-amber-700" />}
              accentColor="amber"
            />
          </>
        )}
      </div>

      {/* Main Content Layout: Books Catalog Preview & Active Tickets */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Books Preview (2 Columns) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-stone-900 tracking-tight">
                Your Catalog
              </h2>
              <p className="text-xs text-stone-500">
                Recent book releases and sales performances
              </p>
            </div>
            <Link
              to="/books"
              className="text-xs font-semibold text-brand-700 hover:text-brand-800 flex items-center gap-1"
            >
              All Books ({books.length})
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <Card>
            {isLoading ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : books.length === 0 ? (
              <div className="p-8 text-center text-stone-500 text-sm">
                No books are linked to your account yet. If you have published with BookLeaf, raise a support ticket and the team will help.
              </div>
            ) : (
              <div className="divide-y divide-stone-100">
                {books.slice(0, 3).map((book) => (
                  <div
                    key={book.id}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-stone-50/70 transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to={`/books/${book.id}`}
                          className="font-semibold text-stone-900 hover:text-brand-700 text-sm truncate"
                        >
                          {book.title}
                        </Link>
                        <StatusBadge status={book.status} />
                      </div>

                      <div className="flex items-center gap-3 text-xs text-stone-500 font-mono">
                        <span>ISBN: {book.isbn}</span>
                        <span>•</span>
                        <span className="font-sans text-stone-600">{book.genre}</span>
                        {book.printPartner && (
                          <>
                            <span>•</span>
                            <span className="font-sans text-stone-500">
                              {book.printPartner}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-end justify-between sm:justify-center shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-stone-100">
                      <div className="text-right">
                        <span className="text-xs text-stone-500">Copies Sold: </span>
                        <span className="text-xs font-bold text-stone-800 font-mono">
                          {formatNumber(book.totalCopiesSold)}
                        </span>
                      </div>
                      <div className="text-right text-xs text-stone-600">
                        Royalty:{" "}
                        <span className="font-semibold text-emerald-700">
                          {formatCurrency(book.totalRoyaltyEarned)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Support Tickets Overview (1 Column) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-stone-900 tracking-tight">
                Support & Inquiries
              </h2>
              <p className="text-xs text-stone-500">
                Direct tickets with editorial & royalty teams
              </p>
            </div>
            <Link
              to="/tickets"
              className="text-xs font-semibold text-brand-700 hover:text-brand-800 flex items-center gap-1"
            >
              View All ({ticketTotal ?? tickets.length})
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <Card>
            {isLoading ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : tickets.length === 0 ? (
              <div className="p-6 text-center text-stone-500 text-xs">
                No tickets filed yet. Have a question about distribution or royalties?
                <div className="mt-3">
                  <Link to="/tickets/new">
                    <Button size="sm" variant="outline">
                      Create Ticket
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-stone-100">
                {tickets.slice(0, 4).map((ticket) => (
                  <Link
                    key={ticket.id}
                    to={`/tickets/${ticket.id}`}
                    className="p-4 block hover:bg-stone-50/70 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <StatusBadge status={ticket.status} />
                      <span className="text-[11px] text-stone-400 font-mono">
                        {new Date(ticket.updatedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-stone-800 line-clamp-2 hover:text-brand-700">
                      {ticket.subject}
                    </p>
                    {ticket.category && (
                      <p className="text-[10px] text-stone-500 mt-1 uppercase font-mono">
                        {ticket.category.replace(/_/g, " ")}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
