import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  DollarSign,
  TrendingUp,
  Printer,
  Globe,
  LifeBuoy,
  Tag,
  CheckCircle2,
  Clock,
  Building2,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import type { Book } from "@bookleaf/contracts";
import { StatusBadge, Badge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { Card, CardHeader, CardContent } from "../../components/common/Card";
import { Skeleton } from "../../components/common/Skeleton";
import { Alert } from "../../components/common/Alert";

export const BookDetailPage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const { client } = useAuth();

  const [book, setBook] = useState<Book | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadBook() {
      if (!bookId) return;
      try {
        setIsLoading(true);
        setError(null);
        const res = await client.getBookById(bookId);
        if (isMounted) {
          setBook(res);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || "Failed to load book record");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadBook();
    return () => {
      isMounted = false;
    };
  }, [client, bookId]);

  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined) return "—";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatNumber = (val: number | null | undefined) => {
    if (val === null || val === undefined) return "0";
    return new Intl.NumberFormat("en-US").format(val);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-3/4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-64 col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="space-y-6">
        <Link to="/books" className="inline-flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-900">
          <ArrowLeft className="w-4 h-4" />
          Back to My Books
        </Link>
        <Alert variant="error" title="Book Record Not Found">
          {error || `No book record exists with internal identifier ${bookId}.`}
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Navigation Breadcrumb */}
      <div>
        <Link
          to="/books"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Catalog
        </Link>
      </div>

      {/* Book Title Banner */}
      <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={book.status} />
            <span className="font-mono text-xs bg-stone-100 text-stone-600 px-2.5 py-1 rounded-md">
              {book.externalBookId}
            </span>
            <span className="text-xs text-stone-500 font-mono">ISBN: {book.isbn}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-stone-900 font-editorial">
            {book.title}
          </h1>
          <p className="text-xs text-stone-600">
            Genre: <span className="font-semibold">{book.genre}</span>
          </p>
        </div>

        <div className="shrink-0 flex items-center gap-3">
          <Link to={`/tickets/new?bookId=${encodeURIComponent(book.id)}`}>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<LifeBuoy className="w-4 h-4" />}
            >
              Submit Ticket For This Title
            </Button>
          </Link>
        </div>
      </div>

      {/* Grid: Financial & Sales Analytics / Publication Metadata */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Sales & Royalty Financial Breakdown */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader
              title="Sales & Royalty Settlement"
              subtitle="Audited financial ledger from wholesale & retail channels"
            />
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-1">
                    Maximum Retail Price
                  </span>
                  <span className="text-xl font-bold text-stone-900 font-mono">
                    {book.mrp !== null ? `₹${book.mrp}` : <span className="text-stone-400 font-normal">Pending pricing</span>}
                  </span>
                </div>

                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-1">
                    Royalty Per Copy
                  </span>
                  <span className="text-xl font-bold text-brand-700 font-mono">
                    {book.authorRoyaltyPerCopy !== null ? (
                      `₹${book.authorRoyaltyPerCopy}`
                    ) : (
                      <span className="text-stone-400 font-normal">Not configured</span>
                    )}
                  </span>
                </div>

                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-1">
                    Total Copies Sold
                  </span>
                  <span className="text-xl font-bold text-stone-900 font-mono">
                    {formatNumber(book.totalCopiesSold)}
                  </span>
                </div>

                <div className="pt-4 border-t border-stone-100">
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-1">
                    Total Royalty Earned
                  </span>
                  <span className="text-xl font-bold text-emerald-700 font-mono">
                    {formatCurrency(book.totalRoyaltyEarned)}
                  </span>
                </div>

                <div className="pt-4 border-t border-stone-100">
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-1">
                    Royalty Disbursed
                  </span>
                  <span className="text-xl font-bold text-stone-800 font-mono">
                    {formatCurrency(book.royaltyPaid)}
                  </span>
                </div>

                <div className="pt-4 border-t border-stone-100">
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-1">
                    Pending Settlement
                  </span>
                  <span className="text-xl font-bold text-amber-700 font-mono">
                    {formatCurrency(book.royaltyPending)}
                  </span>
                </div>
              </div>

              {/* Settlement payout notes */}
              <div className="mt-6 pt-4 border-t border-stone-100 flex items-center justify-between text-xs text-stone-500">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-stone-400" />
                  <span>
                    Last Payout Processed:{" "}
                    <strong className="text-stone-700 font-mono">
                      {book.lastRoyaltyPayoutDate || "No payout processed yet"}
                    </strong>
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Distribution & Availability Channels */}
          <Card>
            <CardHeader
              title="Distribution & Market Availability"
              subtitle="Active print partners and retail network channels"
            />
            <CardContent>
              <div className="space-y-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-2">
                    Print Partner
                  </span>
                  <div className="flex items-center gap-2">
                    <Printer className="w-4 h-4 text-stone-400" />
                    <span className="text-sm font-medium text-stone-800">
                      {book.printPartner || "Not assigned / On-demand production"}
                    </span>
                  </div>
                </div>

                <div className="pt-4 border-t border-stone-100">
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-2">
                    Active Retail Channels ({book.availableOn?.length || 0})
                  </span>
                  {book.availableOn && book.availableOn.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {book.availableOn.map((channel) => (
                        <span
                          key={channel}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-stone-50 text-xs font-medium text-stone-700 shadow-subtle"
                        >
                          <Globe className="w-3.5 h-3.5 text-brand-600" />
                          {channel}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 bg-stone-50 rounded-lg text-xs text-stone-500 border border-stone-200/60">
                      No distribution channels currently active for this title (Draft / Pre-production state).
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right 1 Col: Production & ISBN Metadata */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Book Specifications" />
            <CardContent className="space-y-4 text-xs">
              <div>
                <span className="text-stone-500 block mb-0.5">International Standard Book Number</span>
                <span className="font-mono text-stone-900 font-semibold">{book.isbn}</span>
              </div>

              <div>
                <span className="text-stone-500 block mb-0.5">External Publisher Reference</span>
                <span className="font-mono text-stone-900 font-semibold">{book.externalBookId}</span>
              </div>

              <div>
                <span className="text-stone-500 block mb-0.5">Internal System ID</span>
                <span className="font-mono text-stone-600 text-[11px] break-all">{book.id}</span>
              </div>

              <div>
                <span className="text-stone-500 block mb-0.5">Publication Date</span>
                <span className="text-stone-900 font-medium">
                  {book.publicationDate ? book.publicationDate : "Pending release"}
                </span>
              </div>

              <div>
                <span className="text-stone-500 block mb-0.5">Current Lifecycle Stage</span>
                <div className="mt-1">
                  <StatusBadge status={book.status} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-brand-900 text-brand-50 border-brand-800">
            <CardContent className="space-y-3">
              <h3 className="font-semibold text-white flex items-center gap-2 text-sm">
                <LifeBuoy className="w-4 h-4 text-emerald-400" />
                Editorial Assistance
              </h3>
              <p className="text-xs text-brand-200 leading-relaxed">
                Have questions about your print proofing, royalty statements, or retail distribution for{" "}
                <span className="text-white font-medium">{book.title}</span>?
              </p>
              <Link to={`/tickets/new?bookId=${encodeURIComponent(book.id)}`} className="block pt-2">
                <Button variant="secondary" size="sm" className="w-full">
                  Submit Ticket
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
