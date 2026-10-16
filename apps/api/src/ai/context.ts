/**
 * Data minimisation for the external AI provider. This is the backend's own allowlist, applied before anything is handed to
 * the AI package (which applies a second one). Financial data (MRP, royalty amounts and balances, copies sold, payout dates),
 * the ISBN and all author contact details are never included.
 */
const AI_BOOK_FIELDS = ["title", "status", "genre", "publicationDate", "printPartner", "availableOn"] as const;

export function minimizeBookContext(book: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of AI_BOOK_FIELDS) if (key in book) out[key] = book[key];
  return out;
}
