import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ArrowLeft, Send, Upload, Paperclip, X, Info } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import type { Book } from "@bookleaf/contracts";
import { Input, Textarea } from "../../components/common/Input";
import { Select } from "../../components/common/Select";
import { Button } from "../../components/common/Button";
import { Card, CardHeader, CardContent, CardFooter } from "../../components/common/Card";
import { Alert } from "../../components/common/Alert";

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setSubmitError(null);

    if (!validate()) return;

    try {
      setIsSubmitting(true);
      const res = await client.createTicket({
        bookId: selectedBookId ? selectedBookId : null,
        subject: subject.trim(),
        description: description.trim(),
      });

      navigate(`/tickets/${res.ticket.id}`);
    } catch (err: any) {
      setSubmitError(err.message || "Failed to submit ticket. Please check input.");
    } finally {
      setIsSubmitting(false);
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
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (errors.description) setErrors((prev) => ({ ...prev, description: "" }));
                }}
                error={errors.description}
                helperText={`${description.length}/10,000 characters (minimum 10 characters)`}
                required
              />
            </div>

            {/* Optional Attachment (UI scope per requirements) */}
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
                      ({Math.round(attachment.size / 1024)} KB)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAttachment(null)}
                    className="p-1 text-stone-400 hover:text-red-500 rounded focus-ring"
                    aria-label="Remove attachment"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-stone-200 rounded-xl hover:border-brand-500 cursor-pointer transition-colors bg-stone-50/50">
                  <Upload className="w-5 h-5 text-stone-400 mb-2" />
                  <span className="text-xs font-semibold text-stone-700">
                    Upload screenshot, PDF proof, or bank statement
                  </span>
                  <span className="text-[11px] text-stone-400 mt-0.5">
                    PNG, JPG, PDF up to 10MB (Client-side attachment preview)
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setAttachment(e.target.files[0]);
                      }
                    }}
                  />
                </label>
              )}
            </div>
          </CardContent>

          <CardFooter className="flex justify-between">
            <Link to="/tickets">
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isSubmitting}
              rightIcon={<Send className="w-4 h-4" />}
            >
              Submit Ticket
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
};
