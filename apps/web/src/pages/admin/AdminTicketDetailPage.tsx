import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Send,
  Lock,
  UserCheck,
  UserX,
  Sparkles,
  BookOpen,
  User,
  AlertTriangle,
  CheckCircle,
  Clock,
  ShieldCheck,
  Building,
  RefreshCw,
  FileText,
  Copy,
  Paperclip,
  Download,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import {
  ticketStatuses,
  ticketCategories,
  ticketPriorities,
  type AdminTicketDetailResponse,
} from "@bookleaf/contracts";
import type { AttachmentMeta } from "../../api/client";
import { formatBytes } from "../../api/attachments";

type TicketStatus = (typeof ticketStatuses)[number];
type TicketCategory = (typeof ticketCategories)[number];
type TicketPriority = (typeof ticketPriorities)[number];
import { StatusBadge, Badge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { Input, Textarea } from "../../components/common/Input";
import { Select } from "../../components/common/Select";
import { Card, CardHeader, CardContent } from "../../components/common/Card";
import { Skeleton } from "../../components/common/Skeleton";
import { Alert } from "../../components/common/Alert";
import { AiFailureNotice } from "../../components/admin/AiFailureNotice";

export const AdminTicketDetailPage: React.FC = () => {
  const { ticketId } = useParams<{ ticketId: string }>();
  const { client, user } = useAuth();

  const [data, setData] = useState<AdminTicketDetailResponse | null>(null);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);


  // Form states
  const [replyBody, setReplyBody] = useState("");
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [internalNoteBody, setInternalNoteBody] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);

  // Status / Category / Priority overrides
  const [selectedStatus, setSelectedStatus] = useState<string>("OPEN");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedPriority, setSelectedPriority] = useState<string>("");
  const [isUpdatingProps, setIsUpdatingProps] = useState(false);
  const [updateSuccessMsg, setUpdateSuccessMsg] = useState<string | null>(null);

  // AI re-run state
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const loadTicket = useCallback(async () => {
    if (!ticketId) return;
    try {
      setIsLoading(true);
      setError(null);
      const [res, attachmentsRes] = await Promise.all([
        client.getAdminTicketById(ticketId),
        client.getAdminAttachments(ticketId).catch((err) => {
          console.warn("Failed to load admin attachments:", err);
          return { items: [] };
        }),
      ]);
      setData(res);
      setAttachments(attachmentsRes.items);
      setSelectedStatus(res.ticket.status);
      setSelectedCategory(res.ticket.category || "");
      setSelectedPriority(res.ticket.priority || "");
    } catch (err: any) {
      setError(err.message || "Failed to load admin ticket workbench.");
    } finally {
      setIsLoading(false);
    }
  }, [client, ticketId]);

  useEffect(() => {
    loadTicket();
  }, [loadTicket]);

  const handleDownload = async (attachment: AttachmentMeta) => {
    if (!ticketId || downloadingId) return;
    try {
      setDownloadingId(attachment.id);
      setDownloadError(null);
      setDownloadSuccess(null);
      const res = await client.downloadAdminAttachment(ticketId, attachment.id, attachment.fileName);
      setDownloadSuccess(`Downloaded "${res.fileName}" successfully.`);
      setTimeout(() => setDownloadSuccess(null), 4000);
    } catch (err: any) {
      setDownloadError(err.message || `Failed to download ${attachment.fileName}.`);
    } finally {
      setDownloadingId(null);
    }
  };


  // Send Author-Visible Public Reply
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyBody.trim() || !ticketId) return;

    try {
      setIsSendingReply(true);
      await client.replyToTicket(ticketId, { body: replyBody.trim() });
      setReplyBody("");
      await loadTicket();
    } catch (err: any) {
      alert(`Failed to send reply: ${err.message}`);
    } finally {
      setIsSendingReply(false);
    }
  };

  // Add Confidential Staff Internal Note
  const handleAddInternalNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!internalNoteBody.trim() || !ticketId) return;

    try {
      setIsAddingNote(true);
      await client.addInternalNote(ticketId, { body: internalNoteBody.trim() });
      setInternalNoteBody("");
      await loadTicket();
    } catch (err: any) {
      alert(`Failed to add note: ${err.message}`);
    } finally {
      setIsAddingNote(false);
    }
  };

  // Update Status, Category, Priority Overrides
  const handleUpdateProperties = async () => {
    if (!ticketId) return;
    try {
      setIsUpdatingProps(true);
      setUpdateSuccessMsg(null);
      await client.updateTicket(ticketId, {
        status: selectedStatus as any,
        category: selectedCategory ? (selectedCategory as any) : undefined,
        priority: selectedPriority ? (selectedPriority as any) : undefined,
      });
      setUpdateSuccessMsg("Ticket properties updated successfully.");
      await loadTicket();
      setTimeout(() => setUpdateSuccessMsg(null), 3000);
    } catch (err: any) {
      alert(`Failed to update properties: ${err.message}`);
    } finally {
      setIsUpdatingProps(false);
    }
  };

  // Assignment to Self / Unassign
  const handleToggleAssignment = async () => {
    if (!ticketId || !data) return;
    const isAssignedToMe = data.ticket.assigneeId === user?.id;
    const newAssigneeId = isAssignedToMe ? null : user?.id || "usr_admin_01";

    try {
      await client.assignTicket(ticketId, { assigneeId: newAssigneeId });
      await loadTicket();
    } catch (err: any) {
      alert(`Failed to update assignment: ${err.message}`);
    }
  };

  // Trigger Re-run of AI analysis
  const handleReanalyze = async () => {
    if (!ticketId) return;
    try {
      setIsAnalyzing(true);
      await client.triggerAiAnalysis(ticketId);
      await loadTicket();
    } catch (err: any) {
      alert(`AI analysis request failed: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Use AI draft into public reply box
  const handleUseAiDraft = (draft: string) => {
    setReplyBody(draft);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-3/4" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <Link to="/admin/queue" className="inline-flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-900">
          <ArrowLeft className="w-4 h-4" />
          Back to Queue
        </Link>
        <Alert variant="error" title="Ticket Record Error">
          {error || `Unable to load ticket detail.`}
        </Alert>
      </div>
    );
  }

  const { ticket, author, book, messages, internalNotes, aiAnalysis, auditEvents } = data;
  const isAssignedToMe = ticket.assigneeId === user?.id;

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link
          to="/admin/queue"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Ticket Queue
        </Link>

        <span className="text-xs font-mono text-stone-500">
          Ticket Ref: {ticket.id}
        </span>
      </div>

      {downloadError && (
        <Alert variant="error" title="Download Failed">
          {downloadError}
        </Alert>
      )}

      {downloadSuccess && (
        <Alert variant="info" title="Attachment Downloaded">
          {downloadSuccess}
        </Alert>
      )}

      {/* Title & Status Summary Card */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={ticket.status} />
            {ticket.priority && <StatusBadge status={ticket.priority} />}
            {ticket.category && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-stone-100 text-stone-700 uppercase font-medium">
                {ticket.category.replace(/_/g, " ")}
              </span>
            )}
            <span className="text-xs text-stone-400 font-mono ml-auto">
              Created: {new Date(ticket.createdAt).toLocaleString()}
            </span>
          </div>

          <h1 className="text-2xl font-bold text-stone-900 font-editorial">
            {ticket.subject}
          </h1>

          <div className="p-3.5 bg-stone-50 rounded-lg text-sm text-stone-800 leading-relaxed border border-stone-200/80">
            <span className="text-[11px] uppercase tracking-wider font-bold text-stone-500 block mb-1">
              Author Inquiry Description:
            </span>
            {ticket.description}
          </div>

          {/* Real Attachments Display (Admin) */}
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
        </CardContent>
      </Card>


      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Public Conversation Thread, Send Reply & Confidential Internal Notes */}
        <div className="lg:col-span-2 space-y-6">
          {/* Public Conversation Thread */}
          <Card>
            <CardHeader
              title={`Author Conversation (${messages.length})`}
              subtitle="Messages visible directly to the author"
            />
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {messages.map((msg) => {
                  const isStaff = msg.authorId !== author.userId;

                  return (
                    <div
                      key={msg.id}
                      className={`flex gap-3 ${isStaff ? "justify-end" : "justify-start"}`}
                    >
                      {!isStaff && (
                        <div className="w-8 h-8 rounded-full bg-stone-200 text-stone-700 flex items-center justify-center shrink-0 text-xs font-bold shadow-sm">
                          {author.name.charAt(0)}
                        </div>
                      )}

                      <div
                        className={`max-w-xl rounded-2xl p-4 text-sm shadow-subtle ${
                          isStaff
                            ? "bg-slate-900 text-white rounded-br-none"
                            : "bg-stone-100 text-stone-800 border border-stone-200 rounded-bl-none"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4 mb-1 text-xs">
                          <span
                            className={`font-semibold ${
                              isStaff ? "text-emerald-400" : "text-stone-900"
                            }`}
                          >
                            {isStaff ? "BookLeaf Staff Reply" : `${author.name} (Author)`}
                          </span>
                          <span
                            className={`text-[11px] font-mono ${
                              isStaff ? "text-slate-400" : "text-stone-500"
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

                      {isStaff && (
                        <div className="w-8 h-8 rounded-full bg-emerald-800 text-white flex items-center justify-center shrink-0 text-xs font-bold shadow-sm">
                          <ShieldCheck className="w-4 h-4 text-emerald-300" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Reply Box */}
              <form onSubmit={handleSendReply} className="pt-4 border-t border-stone-200">
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1.5">
                  Send Public Reply to Author
                </label>
                <textarea
                  rows={4}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Compose reply to author (or insert reviewed AI draft from the Copilot panel)..."
                  className="w-full rounded-lg border border-stone-300 p-3 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[11px] text-stone-500">
                    Will trigger email dispatch and live portal notification.
                  </span>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!replyBody.trim() || isSendingReply}
                    isLoading={isSendingReply}
                    rightIcon={<Send className="w-3.5 h-3.5" />}
                  >
                    Send Reply
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Confidential Internal Notes (Visually and Technically Separated) */}
          <div className="bg-amber-50/70 rounded-xl border border-amber-300 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-800" />
                <h3 className="text-sm font-bold text-amber-900 uppercase tracking-wider">
                  Internal Staff Notes
                </h3>
              </div>
              <span className="text-[10px] font-bold uppercase bg-amber-200 text-amber-900 px-2 py-0.5 rounded border border-amber-400">
                Staff Confidential — Never Shared With Author
              </span>
            </div>

            {internalNotes.length === 0 ? (
              <p className="text-xs text-amber-800/80 italic">
                No internal notes recorded on this ticket yet.
              </p>
            ) : (
              <div className="space-y-2.5">
                {internalNotes.map((note) => (
                  <div
                    key={note.id}
                    className="p-3 bg-white rounded-lg border border-amber-200 text-xs text-stone-800 shadow-subtle"
                  >
                    <div className="flex items-center justify-between text-[11px] text-stone-500 mb-1 font-mono">
                      <span>Staff ID: {note.authorId}</span>
                      <span>{new Date(note.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{note.body}</p>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleAddInternalNote} className="pt-2">
              <textarea
                rows={2}
                value={internalNoteBody}
                onChange={(e) => setInternalNoteBody(e.target.value)}
                placeholder="Add private note for editorial or accounting team..."
                className="w-full rounded-lg border border-amber-300 bg-white p-2.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <div className="flex justify-end mt-2">
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={!internalNoteBody.trim() || isAddingNote}
                  isLoading={isAddingNote}
                  className="bg-white border-amber-400 text-amber-900 hover:bg-amber-100"
                >
                  Save Internal Note
                </Button>
              </div>
            </form>
          </div>

          {/* Audit Events & Lifecycle History */}
          <Card>
            <CardHeader
              title={`Audit Log & Lifecycle Events (${auditEvents?.length || 0})`}
              subtitle="Immutable operational trace recorded by API"
            />
            <CardContent>
              {auditEvents && auditEvents.length > 0 ? (
                <div className="space-y-2.5">
                  {auditEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3 bg-stone-50 rounded-lg border border-stone-200 text-xs flex items-center justify-between gap-4 font-mono"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-stone-800 bg-stone-200 px-2 py-0.5 rounded text-[11px]">
                          {ev.action}
                        </span>
                        <span className="text-stone-500 font-sans text-xs">
                          Entity: {ev.entityType} ({ev.entityId})
                        </span>
                      </div>
                      <div className="text-stone-400 text-[11px] shrink-0">
                        {new Date(ev.createdAt).toLocaleString()}
                        {ev.actorId && ` • Actor: ${ev.actorId}`}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-stone-400 italic">No audit records available.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column (1 Col): Ticket Actions, AI Assistant, Author & Book Context */}
        <div className="space-y-6">
          {/* Triage & Override Controls */}
          <Card>
            <CardHeader title="Triage Controls & Assignment" />
            <CardContent className="space-y-4">
              {updateSuccessMsg && (
                <Alert variant="success" className="py-2 text-xs">
                  {updateSuccessMsg}
                </Alert>
              )}

              {/* Assignment control */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-1">
                  Queue Assignment
                </span>
                <div className="flex items-center justify-between p-2.5 bg-stone-50 rounded-lg border border-stone-200 text-xs">
                  <span className="font-mono text-stone-700">
                    {ticket.assigneeId ? (
                      isAssignedToMe ? (
                        <strong className="text-emerald-700">Assigned to You</strong>
                      ) : (
                        `Assigned (${ticket.assigneeId})`
                      )
                    ) : (
                      <span className="text-amber-700 font-medium">Unassigned</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={handleToggleAssignment}
                    className="text-xs font-semibold text-brand-700 hover:text-brand-900 underline"
                  >
                    {isAssignedToMe ? "Unassign Me" : "Assign to Me"}
                  </button>
                </div>
              </div>

              {/* Status Selector */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-1">
                  Ticket Status
                </span>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full rounded-lg border border-stone-200 bg-white p-2 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="OPEN">OPEN</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="RESOLVED">RESOLVED</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </div>

              {/* Priority Override */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-1">
                  Priority Override
                </span>
                <select
                  value={selectedPriority}
                  onChange={(e) => setSelectedPriority(e.target.value)}
                  className="w-full rounded-lg border border-stone-200 bg-white p-2 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Unset</option>
                  <option value="CRITICAL">CRITICAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
              </div>

              {/* Category Override */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 block mb-1">
                  Category Override
                </span>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full rounded-lg border border-stone-200 bg-white p-2 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Unset</option>
                  <option value="ROYALTY_PAYMENTS">ROYALTY_PAYMENTS</option>
                  <option value="PRINTING_QUALITY">PRINTING_QUALITY</option>
                  <option value="ISBN_METADATA">ISBN_METADATA</option>
                  <option value="DISTRIBUTION_AVAILABILITY">DISTRIBUTION_AVAILABILITY</option>
                  <option value="BOOK_STATUS_PRODUCTION">BOOK_STATUS_PRODUCTION</option>
                  <option value="GENERAL_INQUIRY">GENERAL_INQUIRY</option>
                </select>
              </div>

              <Button
                variant="primary"
                size="sm"
                className="w-full text-xs"
                onClick={handleUpdateProperties}
                isLoading={isUpdatingProps}
              >
                Apply Overrides & Update
              </Button>
            </CardContent>
          </Card>

          {/* AI Analysis & Draft Review Card */}
          <div className="bg-slate-900 text-slate-100 rounded-xl border border-slate-800 p-5 shadow-card space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white tracking-tight">
                  AI Copilot Analysis
                </h3>
              </div>
              <button
                type="button"
                onClick={handleReanalyze}
                disabled={isAnalyzing}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 underline flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${isAnalyzing ? "animate-spin" : ""}`} />
                {isAnalyzing ? "Analyzing..." : "Re-run AI"}
              </button>
            </div>

            {aiAnalysis?.status === "COMPLETED" && aiAnalysis.analysis ? (
              <div className="space-y-3 text-xs">
                {/* Confidence & Review Policy */}
                <div className="flex items-center justify-between p-2 rounded bg-slate-800/80 border border-slate-700/80">
                  <span className="text-slate-300 font-mono">
                    Confidence:{" "}
                    <strong className="text-emerald-400">
                      {Math.round(aiAnalysis.analysis.confidence * 100)}%
                    </strong>
                  </span>
                  <span className="text-[10px] font-bold text-amber-400 uppercase bg-amber-950/80 border border-amber-800/80 px-2 py-0.5 rounded">
                    Human Review Required
                  </span>
                </div>

                {/* AI Rationale */}
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    Classification Rationale:
                  </span>
                  <p className="text-slate-300 leading-relaxed bg-slate-950/50 p-2.5 rounded border border-slate-800">
                    {aiAnalysis.analysis.rationale}
                  </p>
                </div>

                {/* KB Citations */}
                {aiAnalysis.analysis.knowledgeBaseCitations.length > 0 && (
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                      Retrieved Policy Grounding:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {aiAnalysis.analysis.knowledgeBaseCitations.map((cite) => (
                        <span
                          key={cite}
                          className="font-mono text-[10px] bg-slate-800 text-emerald-300 px-2 py-0.5 rounded border border-slate-700"
                        >
                          {cite}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Draft Response Box */}
                <div className="pt-2 border-t border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    AI Suggested Draft:
                  </span>
                  <div className="p-3 bg-slate-950 rounded border border-slate-800 text-slate-200 text-xs whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                    {aiAnalysis.analysis.draftResponse}
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="text-xs bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900"
                      leftIcon={<Copy className="w-3.5 h-3.5" />}
                      onClick={() => handleUseAiDraft(aiAnalysis.analysis!.draftResponse)}
                    >
                      Insert Draft into Reply Box
                    </Button>
                  </div>
                </div>
              </div>
            ) : aiAnalysis?.status === "FAILED" ? (
              <AiFailureNotice errorCode={aiAnalysis.errorCode} />
            ) : aiAnalysis?.status === "PENDING" ? (
              <div className="p-4 bg-slate-800/60 rounded text-center text-xs text-slate-400 animate-pulse">
                AI background analysis job currently pending...
              </div>
            ) : (
              <div className="p-4 bg-slate-800/60 rounded text-center text-xs text-slate-400">
                No AI analysis record generated yet for this ticket.
              </div>
            )}
          </div>

          {/* Author Context */}
          <Card>
            <CardHeader title="Author Profile Context" />
            <CardContent className="space-y-2.5 text-xs">
              <div>
                <span className="text-stone-500 block">Name</span>
                <span className="font-semibold text-stone-900 text-sm">{author.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-stone-500 block">External ID</span>
                  <span className="font-mono font-medium text-stone-800">
                    {author.externalAuthorId}
                  </span>
                </div>
                <div>
                  <span className="text-stone-500 block">Joined</span>
                  <span className="font-mono text-stone-800">{author.joinedDate}</span>
                </div>
              </div>
              <div>
                <span className="text-stone-500 block">Location / City</span>
                <span className="text-stone-800">{author.city || <span className="text-stone-400">Not provided</span>}</span>
              </div>
              <div>
                <span className="text-stone-500 block">Contact Phone</span>
                <span className="font-mono text-stone-800">{author.phone || <span className="font-sans text-stone-400">Not provided</span>}</span>
              </div>
            </CardContent>
          </Card>

          {/* Associated Book Context */}
          {book ? (
            <Card>
              <CardHeader title="Associated Book Context" />
              <CardContent className="space-y-2.5 text-xs">
                <div>
                  <span className="text-stone-500 block">Title</span>
                  <Link
                    to={`/books/${book.id}`}
                    className="font-semibold text-brand-700 hover:underline block truncate"
                  >
                    {book.title}
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-stone-500 block">ISBN</span>
                    <span className="font-mono text-stone-800">{book.isbn}</span>
                  </div>
                  <div>
                    <span className="text-stone-500 block">Status</span>
                    <StatusBadge status={book.status} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-stone-100">
                  <div>
                    <span className="text-stone-500 block">Copies Sold</span>
                    <span className="font-mono font-bold text-stone-900">
                      {book.totalCopiesSold}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-500 block">Pending Royalty</span>
                    <span className="font-mono font-bold text-amber-700">
                      ₹{book.royaltyPending}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-xs text-stone-500 text-center">
              General Account Ticket (No specific book linked).
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
