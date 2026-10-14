import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  LifeBuoy,
  Clock,
  Send,
  User,
  ShieldCheck,
  RefreshCw,
  BookOpen,
  Paperclip,
  Download,
  CheckCircle,
  FileText,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import type { Ticket, AuthorTicketMessage } from "@bookleaf/contracts";
import type { AttachmentMeta } from "../../api/client";
import { formatBytes } from "../../api/attachments";
import { StatusBadge, Badge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { Card, CardHeader, CardContent, CardFooter } from "../../components/common/Card";
import { Skeleton } from "../../components/common/Skeleton";
import { Alert } from "../../components/common/Alert";
import { ticketEventManager } from "../../api/events";

export const TicketDetailPage: React.FC = () => {
  const { ticketId } = useParams<{ ticketId: string }>();
  const { client, user } = useAuth();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<AuthorTicketMessage[]>([]);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSnapshotRef = useRef<string | null>(null);

  const loadTicket = useCallback(
    async (showRefreshIndicator = false) => {
      if (!ticketId) return;
      try {
        if (showRefreshIndicator) setIsRefreshing(true);
        setError(null);
        const [ticketRes, attachmentsRes] = await Promise.all([
          client.getTicketById(ticketId),
          client.getAttachments(ticketId).catch((err) => {
            console.warn("Could not load attachments for ticket:", err);
            return { items: [] };
          }),
        ]);

        // Avoid duplicate UI updates when polling and SSE overlap
        const snapshot = `${ticketRes.ticket.updatedAt}_${ticketRes.ticket.status}_${ticketRes.messages.length}_${attachmentsRes.items.length}`;
        if (!showRefreshIndicator && lastSnapshotRef.current === snapshot) {
          return;
        }
        lastSnapshotRef.current = snapshot;

        setTicket(ticketRes.ticket);
        // Guarantee only author-visible messages are rendered
        setMessages(ticketRes.messages.filter((m) => m.visibility === "AUTHOR"));
        setAttachments(attachmentsRes.items);
        ticketEventManager.recordTicketVersion(ticketRes.ticket.id, ticketRes.ticket.updatedAt);
      } catch (err: any) {
        setError(err.message || "Failed to load ticket conversation.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [client, ticketId]
  );


  useEffect(() => {
    loadTicket();

    // Polling fallback every 25 seconds per API contract
    const interval = setInterval(() => {
      loadTicket(false);
    }, 25000);

    return () => clearInterval(interval);
  }, [loadTicket]);

  // Live SSE listener
  useEffect(() => {
    const unsubscribe = ticketEventManager.subscribe((event) => {
      if (!event.payload.ticketId || event.payload.ticketId === ticketId) {
        loadTicket(false);
      }
    });
    return unsubscribe;
  }, [loadTicket, ticketId]);

  const scrollToBottom = () => {
    if (typeof messagesEndRef.current?.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = replyText.trim();
    if (!trimmed || !ticketId || isSending) return;

    try {
      setIsSending(true);
      setReplyError(null);

      const res = await (client.replyToAuthorTicket
        ? client.replyToAuthorTicket(ticketId, { body: trimmed })
        : client.addAuthorReply(ticketId, { body: trimmed }));

      // Display the persisted reply in the conversation (avoid duplicates)
      setMessages((prev) => {
        if (prev.some((m) => m.id === res.message.id)) {
          return prev;
        }
        return [...prev, res.message];
      });

      // Clear the reply input only after successfully saving
      setReplyText("");
    } catch (err: any) {
      console.error("Failed to send reply:", err);
      if (err?.status === 409 || err?.code === "CONFLICT") {
        setReplyError("This ticket is closed. Further replies are not permitted.");
        // Update ticket status to CLOSED immediately
        setTicket((prev) => (prev ? { ...prev, status: "CLOSED" } : prev));
      } else if (err?.status === 403 || err?.code === "FORBIDDEN") {
        setReplyError(err.message || "You are not authorized to reply to this ticket.");
      } else if (err?.status === 401 || err?.code === "UNAUTHENTICATED") {
        setReplyError("Your session has expired. Please log in again.");
      } else if (err?.status === 400 || err?.code === "VALIDATION_ERROR") {
        setReplyError(err.message || "Message validation failed. Please check your reply.");
      } else {
        setReplyError(err.message || "Failed to send reply. Please try again.");
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleDownload = async (attachment: AttachmentMeta) => {
    if (!ticketId || downloadingId) return;
    try {
      setDownloadingId(attachment.id);
      setDownloadError(null);
      setDownloadSuccess(null);
      const res = await client.downloadAttachment(ticketId, attachment.id, attachment.fileName);
      setDownloadSuccess(`Downloaded "${res.fileName}" successfully.`);
      setTimeout(() => setDownloadSuccess(null), 4000);
    } catch (err: any) {
      setDownloadError(err.message || `Failed to download ${attachment.fileName}.`);
    } finally {
      setDownloadingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="space-y-6">
        <Link to="/tickets" className="inline-flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-900">
          <ArrowLeft className="w-4 h-4" />
          Back to Tickets
        </Link>
        <Alert variant="error" title="Ticket Record Error">
          {error || `Ticket ${ticketId} could not be located.`}
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Navigation & Status */}
      <div className="flex items-center justify-between">
        <Link
          to="/tickets"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to All Tickets
        </Link>

        <button
          onClick={() => loadTicket(true)}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-900 focus-ring p-1 rounded"
          title="Manually sync updates with server"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-brand-600" : ""}`} />
          <span>{isRefreshing ? "Syncing..." : "Sync Updates"}</span>
        </button>
      </div>

      {downloadError && (
        <Alert variant="error" title="Download Error">
          {downloadError}
        </Alert>
      )}

      {downloadSuccess && (
        <Alert variant="info" title="Attachment Download">
          {downloadSuccess}
        </Alert>
      )}


      {/* Ticket Subject Card */}
      <Card className="shadow-card">
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <StatusBadge status={ticket.status} />
            {ticket.category && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-stone-100 text-stone-700 uppercase font-medium">
                {ticket.category.replace(/_/g, " ")}
              </span>
            )}
            {ticket.priority && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded border border-stone-200 text-stone-500">
                Priority: {ticket.priority}
              </span>
            )}
            <span className="text-xs font-mono text-stone-400 ml-auto">
              ID: {ticket.id}
            </span>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-stone-900 font-editorial">
            {ticket.subject}
          </h1>

          {/* Book association context */}
          {ticket.bookId && (
            <div className="flex items-center gap-2 text-xs text-stone-600 bg-stone-50 p-2.5 rounded-lg border border-stone-200">
              <BookOpen className="w-4 h-4 text-brand-600 shrink-0" />
              <span>
                Associated Title: <strong>{ticket.bookId}</strong>
              </span>
              <Link
                to={`/books/${ticket.bookId}`}
                className="ml-auto text-brand-700 hover:text-brand-900 font-semibold underline text-[11px]"
              >
                View Book Details
              </Link>
            </div>
          )}

          {/* Original Inquiry Description */}
          <div className="p-4 bg-stone-50 rounded-xl border border-stone-200/80 space-y-1.5">
            <span className="text-[11px] uppercase tracking-wider font-bold text-stone-500">
              Original Inquiry Description:
            </span>
            <p className="text-sm text-stone-800 leading-relaxed whitespace-pre-wrap">
              {ticket.description}
            </p>
          </div>

          {/* Real Attachments Display */}
          {attachments.length > 0 && (
            <div className="pt-3 border-t border-stone-100 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-600">
                <Paperclip className="w-4 h-4 text-brand-600" />
                <span>Attached Documents ({attachments.length}):</span>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="inline-flex items-center gap-2.5 px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-xs hover:border-stone-300 transition-colors"
                  >
                    <FileText className="w-4 h-4 text-brand-600 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-medium text-stone-800">{att.fileName}</span>
                      <div className="flex items-center gap-1.5 text-[10px] text-stone-400 font-mono">
                        {att.contentType && <span>{att.contentType}</span>}
                        {att.sizeBytes && (
                          <>
                            <span>•</span>
                            <span>{formatBytes(att.sizeBytes)}</span>
                          </>
                        )}
                        {att.createdAt && (
                          <>
                            <span>•</span>
                            <span>{new Date(att.createdAt).toLocaleDateString()}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownload(att)}
                      disabled={downloadingId === att.id}
                      className="ml-1 p-1 text-brand-700 hover:text-brand-900 hover:bg-stone-200/60 rounded transition-colors focus-ring"
                      title={`Download ${att.fileName}`}
                      aria-label={`Download ${att.fileName}`}
                    >
                      {downloadingId === att.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-brand-600" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-xs text-stone-400 font-mono text-[11px]">
            <span>Status: {ticket.status}</span>
            <div className="flex items-center gap-4">
              <span>Created: {new Date(ticket.createdAt).toLocaleDateString()}</span>
              <span>•</span>
              <span>Updated: {new Date(ticket.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>

        </CardContent>
      </Card>

      {/* Message Thread */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500">
            Author & Editorial Conversation ({messages.length})
          </h2>
          <span className="text-[11px] text-stone-400">
            Only staff replies and your submissions appear here
          </span>
        </div>

        <div className="space-y-3">
          {messages.map((msg) => {
            const isAuthor = msg.authorId === user?.id || msg.authorId === "usr_auth_01";

            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${isAuthor ? "justify-end" : "justify-start"}`}
              >
                {!isAuthor && (
                  <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center shrink-0 text-xs font-bold shadow-sm">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  </div>
                )}

                <div
                  className={`max-w-xl rounded-2xl p-4 text-sm shadow-subtle ${
                    isAuthor
                      ? "bg-brand-600 text-white rounded-br-none"
                      : "bg-white text-stone-800 border border-stone-200 rounded-bl-none"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4 mb-1.5 text-xs">
                    <span
                      className={`font-semibold ${
                        isAuthor ? "text-emerald-100" : "text-stone-900"
                      }`}
                    >
                      {isAuthor ? "You (Author)" : "BookLeaf Editorial Support"}
                    </span>
                    <span
                      className={`text-[11px] font-mono ${
                        isAuthor ? "text-emerald-200" : "text-stone-400"
                      }`}
                    >
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                </div>

                {isAuthor && (
                  <div className="w-8 h-8 rounded-full bg-emerald-700 text-white flex items-center justify-center shrink-0 text-xs font-bold shadow-sm">
                    {user?.authorProfile?.name
                      ? user.authorProfile.name.charAt(0)
                      : "A"}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply Box */}
        {ticket.status !== "CLOSED" ? (
          <form onSubmit={handleSendReply} className="mt-6">
            <Card className="shadow-card">
              <CardContent className="p-4 space-y-3">
                {replyError && (
                  <div
                    role="alert"
                    className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center justify-between"
                  >
                    <span>{replyError}</span>
                    <button
                      type="button"
                      onClick={() => setReplyError(null)}
                      className="text-red-500 hover:text-red-700 font-bold ml-2 text-sm"
                      aria-label="Dismiss error"
                    >
                      ×
                    </button>
                  </div>
                )}
                <textarea
                  rows={3}
                  value={replyText}
                  onChange={(e) => {
                    setReplyText(e.target.value);
                    if (replyError) setReplyError(null);
                  }}
                  disabled={isSending}
                  placeholder="Type your reply to BookLeaf support..."
                  className="w-full rounded-lg border border-stone-200 p-3 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 disabled:opacity-60"
                />
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-stone-400">
                    Notifications will be sent to the assigned editorial staff.
                  </span>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!replyText.trim() || isSending}
                    isLoading={isSending}
                    rightIcon={<Send className="w-3.5 h-3.5" />}
                  >
                    Send Reply
                  </Button>
                </div>
              </CardContent>
            </Card>
          </form>
        ) : (
          <div className="p-4 bg-stone-100 rounded-xl text-center text-xs text-stone-500 border border-stone-200">
            This ticket is closed. To reopen or discuss further matters, please create a new ticket.
          </div>
        )}
      </div>
    </div>
  );
};
