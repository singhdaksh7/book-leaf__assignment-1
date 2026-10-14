import { ticketCategories, ticketPriorities } from "@bookleaf/contracts";

export { ticketCategories, ticketPriorities };
export type TicketCategory = (typeof ticketCategories)[number];
export type TicketPriority = (typeof ticketPriorities)[number];

/** Display names are the assignment's category names; wire values stay the contract enums. */
export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  ROYALTY_PAYMENTS: "Royalty & Payments",
  ISBN_METADATA: "ISBN & Metadata Issues",
  PRINTING_QUALITY: "Printing & Quality",
  DISTRIBUTION_AVAILABILITY: "Distribution & Availability",
  BOOK_STATUS_PRODUCTION: "Book Status & Production Updates",
  GENERAL_INQUIRY: "General Inquiry"
};

/** Ascending severity, used for floors: LOW < MEDIUM < HIGH < CRITICAL. */
export const PRIORITY_RANK: Record<TicketPriority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
export function maxPriority(a: TicketPriority, b: TicketPriority): TicketPriority {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;
}
