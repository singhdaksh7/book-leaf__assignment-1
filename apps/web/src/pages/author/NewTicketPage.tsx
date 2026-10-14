import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ArrowLeft, Send, Upload, Paperclip, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import type { Book } from "@bookleaf/contracts";
import { Input, Textarea } from "../../components/common/Input";
import { Select } from "../../components/common/Select";
import { Button } from "../../components/common/Button";
import { Card, CardHeader, CardContent, CardFooter } from "../../components/common/Card";
import { Alert } from "../../components/common/Alert";
import { validateAttachmentFile, formatBytes } from "../../api/attachments";

export const NewTicketPage: React.FC = () => {
  const { client } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string>(
    searchParams.get("bookId") || ""
  );
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const [createdTicketId, setCreatedTicketId] = useState<string | null>(null);
  const [partialSuccess, setPartialSuccess] = useState<{ ticketId: string; error: string } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    async function loadBooks() {
      try {
        const res = await client.getBooks({ page: 1, pageSize: 100 });
        setBooks(res.items);
      } catch (err) {
        console.warn("Could not load books for ticket dropdown:", err);
      }
    }
    loadBooks();
  }, [client]);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!subject.trim() || subject.trim().length < 3) {
      errs.subject = "Subject must be at least 3 characters long.";
    } else if (subject.trim().length > 200) {
      errs.subject = "Subject cannot exceed 200 characters.";
    }

    if (!description.trim() || description.trim().length < 10) {
      errs.description = "Description must provide at least 10 characters of context.";
    } else if (description.trim().length > 10000) {
      errs.description = "Description cannot exceed 10,000 characters.";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachmentError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateAttachmentFile(file);
    if (!validation.valid) {
      setAttachmentError(validation.error || "Invalid attachment file.");
      setAttachment(null);
      e.target.value = "";
      return;
    }

    setAttachment(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setSubmitError(null);
    setPartialSuccess(null);

    // If ticket was already created in partial success state, only retry attachment upload
    if (!createdTicketId) {
      if (!validate()) return;
    }

    if (attachment) {
      const validation = validateAttachmentFile(attachment);
      if (!validation.valid) {
        setAttachmentError(validation.error || "Invalid attachment file.");
        return;
      }
    }

    try {
      setIsSubmitting(true);
      let ticketId = createdTicketId;

      if (!ticketId) {
        setUploadStatus("Creating support ticket...");
        const res = await client.createTicket({
          bookId: selectedBookId ? selectedBookId : null,
          subject: subject.trim(),
          description: description.trim(),
        });
        ticketId = res.ticket.id;
        setCreatedTicketId(ticketId);
      }

      if (attachment && ticketId) {
        setUploadStatus("Uploading attachment...");
        try {
          await client.uploadAttachment(ticketId, attachment);
        } catch (uploadErr: any) {
          // Ticket succeeded, attachment failed: do not report full failure
          setPartialSuccess({
            ticketId,
            error: uploadErr.message || "Failed to upload attachment file to server.",
          });
          return;
        }
      }

      navigate(`/tickets/${ticketId}`);
    } catch (err: any) {
      setSubmitError(err.message || "Failed to submit ticket. Please check input.");
    } finally {
      setIsSubmitting(false);
      setUploadStatus(null);
    }
  };


  const bookOptions = [
    { value: "", label: "General / Account Level (No specific title)" },
    ...books.map((b) => ({
      value: b.id,
      label: `${b.title} (${b.isbn})`,
    })),
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link
          to="/tickets"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Tickets
        </Link>
      </div>

      <div className="pb-2 border-b border-stone-200">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 font-editorial">
          Create New Support Ticket
        </h1>
        <p className="text-sm text-stone-500 mt-1">
          Direct your inquiry to BookLeaf publishing, distribution, or royalty accounting teams.
        </p>
      </div>

      {submitError && (
        <Alert variant="error" title="Submission Error">
          {submitError}
        </Alert>
      )}

      {partialSuccess && (
        <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 space-y-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="font-semibold text-sm text-amber-900">
                Ticket Created (Attachment Upload Failed)
              </h3>
              <p className="text-xs text-amber-800">
                Ticket <strong>{partialSuccess.ticketId}</strong> was created successfully, but your attachment could not be uploaded:
              </p>
              <p className="text-xs font-mono bg-amber-100/80 p-2 rounded text-amber-950 border border-amber-200">
                {partialSuccess.error}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting}
              isLoading={isSubmitting}
            >
              Retry Attachment Upload
            </Button>
            <Link
              to={`/tickets/${partialSuccess.ticketId}`}
              className="text-xs font-semibold text-stone-600 hover:text-stone-900 underline"
            >
              Continue to Ticket Without Attachment
            </Link>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <Card>
          <CardHeader
            title="Ticket Details"
            subtitle="Provide accurate context to accelerate editorial resolution"
          />
          <CardContent className="space-y-6">
            {/* Book Selection */}
            <div>
              <Select
                id="ticket-book"
                label="Associated Title"
                options={bookOptions}
                value={selectedBookId}
                disabled={Boolean(createdTicketId) || isSubmitting}
                onChange={(e) => setSelectedBookId(e.target.value)}
                helperText="Select a published book, or choose General/Account Level for tax, profile, or banking questions."
              />
            </div>

            {/* Subject */}
            <div>
              <Input
                id="ticket-subject"
                label="Subject Summary"
                placeholder="e.g., Q1 Royalty payout clarification for print distributor sales"
                value={subject}
                disabled={Boolean(createdTicketId) || isSubmitting}
                onChange={(e) => {
                  setSubject(e.target.value);
                  if (errors.subject) setErrors((prev) => ({ ...prev, subject: "" }));
                }}
                error={errors.subject}
                helperText={`${subject.length}/200 characters`}
                required
              />
            </div>

            {/* Description */}
            <div>
              <Textarea
                id="ticket-description"
                rows={6}
                label="Detailed Description"
                placeholder="Provide thorough context including dates, ISBN references, retailer channels, or specific queries..."
                value={description}
                disabled={Boolean(createdTicketId) || isSubmitting}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (errors.description) setErrors((prev) => ({ ...prev, description: "" }));
                }}
                error={errors.description}
                helperText={`${description.length}/10,000 characters (minimum 10 characters)`}
                required
              />
            </div>

            {/* Optional Attachment */}
            <div className="pt-2 border-t border-stone-100">
              <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1.5">
                Optional Attachment
              </label>

              {attachment ? (
                <div className="flex items-center justify-between p-3 bg-stone-50 rounded-lg border border-stone-200 text-xs">
                  <div className="flex items-center gap-2">
                    <Paperclip className="w-4 h-4 text-brand-600" />
                    <span className="font-medium text-stone-800">{attachment.name}</span>
                    <span className="text-stone-400">
                      ({formatBytes(attachment.size)})
                    </span>
                  </div>
                  {!isSubmitting && (
                    <button
                      type="button"
                      onClick={() => {
                        setAttachment(null);
                        setAttachmentError(null);
                      }}
                      className="p-1 text-stone-400 hover:text-red-500 rounded focus-ring"
                      aria-label="Remove attachment"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-stone-200 rounded-xl hover:border-brand-500 cursor-pointer transition-colors bg-stone-50/50">
                  <Upload className="w-5 h-5 text-stone-400 mb-2" />
                  <span className="text-xs font-semibold text-stone-700">
                    Upload screenshot, PDF proof, or text statement
                  </span>
                  <span className="text-[11px] text-stone-400 mt-0.5">
                    PDF, PNG, JPG, WebP, Plain Text up to 5 MB
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,application/pdf,image/png,image/jpeg,image/webp,text/plain"
                    disabled={isSubmitting}
                    onChange={handleFileChange}
                  />
                </label>
              )}

              {attachmentError && (
                <p className="mt-1.5 text-xs text-red-600 font-medium" role="alert">
                  {attachmentError}
                </p>
              )}

              {uploadStatus && (
                <p className="mt-2 text-xs text-brand-700 font-medium animate-pulse">
                  {uploadStatus}
                </p>
              )}
            </div>
          </CardContent>

          <CardFooter className="flex justify-between">
            <Link to="/tickets">
              <Button variant="ghost" size="sm" disabled={isSubmitting}>
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={isSubmitting}
              isLoading={isSubmitting}
              rightIcon={<Send className="w-4 h-4" />}
            >
              {createdTicketId
                ? "Retry Attachment Upload"
                : isSubmitting
                ? uploadStatus || "Submitting..."
                : "Submit Ticket"}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
};
