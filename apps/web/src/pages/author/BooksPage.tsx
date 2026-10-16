import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Search,
  Filter,
  ArrowRight,
  LayoutGrid,
  List,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  DollarSign,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import type { Book } from "@bookleaf/contracts";
import { StatusBadge, Badge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { Card, CardContent } from "../../components/common/Card";
import { Skeleton, TableSkeleton } from "../../components/common/Skeleton";
import { EmptyState } from "../../components/common/EmptyState";
import { Alert } from "../../components/common/Alert";

export const BooksPage: React.FC = () => {
  const { client } = useAuth();

  const [books, setBooks] = useState<Book[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenre, setSelectedGenre] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");

  useEffect(() => {
    let isMounted = true;

    async function loadBooks() {
      try {
        setIsLoading(true);
        setError(null);
        const res = await client.getBooks({ page, pageSize });
        if (isMounted) {
          setBooks(res.items);
          setTotal(res.total);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || "Failed to load author books");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadBooks();
    return () => {
      isMounted = false;
    };
  }, [client, page, pageSize]);

  // Extract unique genres for filter dropdown
  const genres = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => {
      if (b.genre) set.add(b.genre);
    });
    return Array.from(set).sort();
  }, [books]);

  // Client-side filtering across search query, genre, and status
  const filteredBooks = useMemo(() => {
    return books.filter((book) => {
      const matchesSearch =
        searchQuery === "" ||
        book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        book.isbn.toLowerCase().includes(searchQuery.toLowerCase()) ||
        book.externalBookId.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesGenre = selectedGenre === "ALL" || book.genre === selectedGenre;
      const matchesStatus =
        selectedStatus === "ALL" || book.status.toUpperCase() === selectedStatus.toUpperCase();

      return matchesSearch && matchesGenre && matchesStatus;
    });
  }, [books, searchQuery, selectedGenre, selectedStatus]);

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

  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-stone-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 font-editorial">
            My Books
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            Author catalog, ISBN records, sales performance, and royalty settlement tracking.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center border border-stone-200 bg-white rounded-lg p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`p-1.5 rounded text-xs flex items-center gap-1 ${
                viewMode === "table"
                  ? "bg-stone-100 text-stone-900 font-semibold"
                  : "text-stone-500 hover:text-stone-900"
              }`}
              title="Table view"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded text-xs flex items-center gap-1 ${
                viewMode === "grid"
                  ? "bg-stone-100 text-stone-900 font-semibold"
                  : "text-stone-500 hover:text-stone-900"
              }`}
              title="Grid view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="error" title="Catalog Loading Error">
          {error}
        </Alert>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="w-full md:w-80">
          <Input
            id="book-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, ISBN, or Book ID..."
            leftIcon={<Search className="w-4 h-4" />}
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
              Genre:
            </span>
            <select
              value={selectedGenre}
              onChange={(e) => setSelectedGenre(e.target.value)}
              className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="ALL">All Genres ({books.length})</option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
              Status:
            </span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="PUBLISHED">Published</option>
              <option value="IN_REVIEW">In Review</option>
              <option value="DRAFT_TYPESETTING">Draft / Typesetting</option>
            </select>
          </div>
        </div>
      </div>

      {/* Books Content: Table or Grid */}
      {isLoading ? (
        <Card className="p-6">
          <TableSkeleton rows={5} />
        </Card>
      ) : filteredBooks.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="w-8 h-8 text-stone-400" />}
          title="No books found"
          description={
            searchQuery || selectedGenre !== "ALL" || selectedStatus !== "ALL"
              ? "No titles matched your active search or filter criteria."
              : "No books are linked to your account yet. If you have published with BookLeaf, raise a support ticket and the team will help."
          }
          action={
            (searchQuery || selectedGenre !== "ALL" || selectedStatus !== "ALL") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedGenre("ALL");
                  setSelectedStatus("ALL");
                }}
              >
                Clear Filters
              </Button>
            )
          }
        />
      ) : viewMode === "table" ? (
        /* Table View */
        <div className="bg-white rounded-xl border border-stone-200/90 shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-stone-700">
              <thead className="bg-stone-50 border-b border-stone-200 text-xs font-semibold uppercase tracking-wider text-stone-500">
                <tr>
                  <th scope="col" className="px-5 py-3.5">
                    Title & Identifiers
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Genre
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right">
                    MRP
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right">
                    Sold
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right">
                    Royalty Earned
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right">
                    Pending
                  </th>
                  <th scope="col" className="px-5 py-3.5 text-center">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredBooks.map((book) => (
                  <tr
                    key={book.id}
                    className="hover:bg-stone-50/80 transition-colors group"
                  >
                    <td className="px-5 py-4 min-w-[240px]">
                      <div className="font-semibold text-stone-900 group-hover:text-brand-700">
                        <Link to={`/books/${book.id}`}>{book.title}</Link>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-stone-500 font-mono">
                        <span>{book.isbn}</span>
                        <span>•</span>
                        <span className="text-stone-400">{book.externalBookId}</span>
                      </div>
                    </td>

                    <td className="px-4 py-4 text-xs font-medium text-stone-600 whitespace-nowrap">
                      {book.genre}
                    </td>

                    <td className="px-4 py-4 whitespace-nowrap">
                      <StatusBadge status={book.status} />
                    </td>

                    <td className="px-4 py-4 text-right text-xs font-mono text-stone-800 whitespace-nowrap">
                      {book.mrp !== null ? `₹${book.mrp}` : <span className="text-stone-400">—</span>}
                    </td>

                    <td className="px-4 py-4 text-right text-xs font-mono font-medium text-stone-900 whitespace-nowrap">
                      {formatNumber(book.totalCopiesSold)}
                    </td>

                    <td className="px-4 py-4 text-right text-xs font-mono font-semibold text-emerald-700 whitespace-nowrap">
                      {formatCurrency(book.totalRoyaltyEarned)}
                    </td>

                    <td className="px-4 py-4 text-right text-xs font-mono whitespace-nowrap">
                      {book.royaltyPending > 0 ? (
                        <span className="font-semibold text-amber-700">
                          {formatCurrency(book.royaltyPending)}
                        </span>
                      ) : (
                        <span className="text-stone-400">₹0</span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-center whitespace-nowrap">
                      <Link to={`/books/${book.id}`}>
                        <Button variant="ghost" size="sm" className="text-xs">
                          Details
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Grid View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredBooks.map((book) => (
            <Card key={book.id} hoverable className="flex flex-col justify-between">
              <div className="p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <StatusBadge status={book.status} />
                  <span className="text-[11px] font-mono text-stone-400">
                    {book.externalBookId}
                  </span>
                </div>

                <div>
                  <h3 className="font-semibold text-base text-stone-900 hover:text-brand-700 transition-colors line-clamp-2">
                    <Link to={`/books/${book.id}`}>{book.title}</Link>
                  </h3>
                  <p className="text-xs text-stone-500 mt-1 font-mono">
                    ISBN: {book.isbn}
                  </p>
                  <p className="text-xs text-stone-600 mt-0.5">
                    Genre: <span className="font-medium">{book.genre}</span>
                  </p>
                </div>

                <div className="pt-3 border-t border-stone-100 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-stone-500 block">Copies Sold</span>
                    <span className="font-bold text-stone-900 font-mono text-sm">
                      {formatNumber(book.totalCopiesSold)}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-500 block">Royalty Earned</span>
                    <span className="font-bold text-emerald-700 font-mono text-sm">
                      {formatCurrency(book.totalRoyaltyEarned)}
                    </span>
                  </div>
                </div>

                {book.availableOn && book.availableOn.length > 0 && (
                  <div className="pt-2">
                    <span className="text-[10px] uppercase font-bold text-stone-500 block mb-1">
                      Available Channels
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {book.availableOn.map((ch) => (
                        <span
                          key={ch}
                          className="text-[10px] bg-stone-100 text-stone-700 px-1.5 py-0.5 rounded font-medium"
                        >
                          {ch}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 bg-stone-50/60 border-t border-stone-100 rounded-b-xl flex items-center justify-between">
                <span className="text-xs text-stone-500 font-mono">
                  MRP: {book.mrp ? `₹${book.mrp}` : "—"}
                </span>
                <Link to={`/books/${book.id}`}>
                  <Button variant="outline" size="sm">
                    View Book
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-stone-200 text-xs text-stone-500">
          <div>
            Showing Page <span className="font-semibold text-stone-900">{page}</span> of{" "}
            <span className="font-semibold text-stone-900">{totalPages}</span> ({total} titles)
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              leftIcon={<ChevronLeft className="w-4 h-4" />}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              rightIcon={<ChevronRight className="w-4 h-4" />}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
