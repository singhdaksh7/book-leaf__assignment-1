import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ShieldAlert,
  Clock,
  UserCheck,
  Sparkles,
  ArrowRight,
  Filter,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  LifeBuoy,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import type { TicketSummary } from "@bookleaf/contracts";
import { StatCard } from "../../components/common/StatCard";
import { Card, CardHeader, CardContent } from "../../components/common/Card";
import { StatusBadge, Badge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { TableSkeleton, CardSkeleton } from "../../components/common/Skeleton";
import { Alert } from "../../components/common/Alert";

export const AdminDashboardPage: React.FC = () => {
  const { client, user } = useAuth();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadAdminData() {
      try {
        setIsLoading(true);
        setError(null);
        const res = await client.getAdminTickets({ page: 1, pageSize: 50 });
        if (isMounted) {
          setTickets(res.items);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || "Failed to load admin queue metrics");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }
    loadAdminData();
    return () => {
      isMounted = false;
    };
  }, [client]);

  const metrics = useMemo(() => {
    const unresolved = tickets.filter(
      (t) => t.status === "OPEN" || t.status === "IN_PROGRESS"
    );
    const critical = unresolved.filter(
      (t) => t.priority === "CRITICAL" || t.priority === "HIGH"
    );
    const unassigned = unresolved.filter((t) => !t.assigneeId);
    const assignedToMe = unresolved.filter((t) => t.assigneeId === user?.id);

    return {
      total: tickets.length,
      unresolvedCount: unresolved.length,
      criticalCount: critical.length,
      unassignedCount: unassigned.length,
      assignedToMeCount: assignedToMe.length,
    };
  }, [tickets, user]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-stone-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 font-editorial flex items-center gap-2">
            Editorial & Support Queue
            <span className="text-xs font-mono uppercase bg-amber-100 text-amber-800 px-2 py-0.5 rounded border border-amber-300">
              Admin Console
            </span>
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            Prioritized author inquiries, AI-assisted drafts, and resolution tracking.
          </p>
        </div>

        <Link to="/admin/queue">
          <Button
            variant="primary"
            size="sm"
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Open Ticket Queue ({metrics.unresolvedCount})
          </Button>
        </Link>
      </div>

      {error && (
        <Alert variant="error" title="Admin Queue Sync Error">
          {error}
        </Alert>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              title="Unresolved Tickets"
              value={metrics.unresolvedCount}
              subtitle="Open or in-progress inquiries"
              icon={<Clock className="w-5 h-5 text-sky-700" />}
              accentColor="sky"
            />
            <StatCard
              title="Urgent & Critical"
              value={metrics.criticalCount}
              subtitle="High priority SLA attention"
              icon={<AlertTriangle className="w-5 h-5 text-red-700" />}
              accentColor="amber"
            />
            <StatCard
              title="Awaiting Assignment"
              value={metrics.unassignedCount}
              subtitle="Unallocated in staff queue"
              icon={<ShieldAlert className="w-5 h-5 text-amber-700" />}
              accentColor="amber"
            />
            <StatCard
              title="Assigned to Me"
              value={metrics.assignedToMeCount}
              subtitle="Under your active review"
              icon={<UserCheck className="w-5 h-5 text-emerald-700" />}
              accentColor="emerald"
            />
          </>
        )}
      </div>

      {/* Oldest Urgent Inquiries Preview */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-stone-900 tracking-tight">
              Priority Queue (Oldest Urgent First)
            </h2>
            <p className="text-xs text-stone-500">
              Immediate author attention items ordered per SLA policy
            </p>
          </div>
          <Link
            to="/admin/queue"
            className="text-xs font-semibold text-brand-700 hover:text-brand-800 flex items-center gap-1"
          >
            View Complete Queue
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="p-6">
              <TableSkeleton rows={4} />
            </div>
          ) : tickets.length === 0 ? (
            <div className="p-8 text-center text-sm text-stone-500">
              No tickets currently pending in the queue.
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {tickets.slice(0, 5).map((ticket) => (
                <Link
                  key={ticket.id}
                  to={`/admin/tickets/${ticket.id}`}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-stone-50 transition-colors group block"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={ticket.status} />
                      {ticket.priority && (
                        <StatusBadge status={ticket.priority} />
                      )}
                      {ticket.category && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-stone-100 text-stone-700 uppercase">
                          {ticket.category.replace(/_/g, " ")}
                        </span>
                      )}
                      <span className="text-xs text-stone-400 font-mono">
                        {ticket.id}
                      </span>
                    </div>

                    <h3 className="font-semibold text-stone-900 text-sm group-hover:text-brand-700 transition-colors">
                      {ticket.subject}
                    </h3>

                    <div className="flex items-center gap-3 text-xs text-stone-500 font-mono">
                      <span>
                        Created: {new Date(ticket.createdAt).toLocaleDateString()}
                      </span>
                      <span>•</span>
                      <span>
                        {ticket.assigneeId ? (
                          <span className="text-stone-700 font-medium font-sans">
                            Staff Assigned
                          </span>
                        ) : (
                          <span className="text-amber-700 font-semibold font-sans">
                            Unassigned
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2 text-stone-400 group-hover:text-stone-800">
                    <span className="text-xs font-medium hidden sm:inline">Review & Reply</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
