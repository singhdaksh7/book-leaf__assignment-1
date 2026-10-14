import type { TicketCategory } from "../categories.js";

/**
 * Deterministic drafts used when the model is unavailable or its draft is rejected. Every figure comes verbatim from
 * the BookLeaf knowledge base (45 days, ₹1,000 [currency symbol unconfirmed], 5–7, 7–10, 24–48). They give no response
 * time frame of their own: the source documents only specify one for reported ISBN errors, so the admin adds any other.
 * They state no account facts, dates, amounts or completed actions, and tell the author what happens next.
 * The admin still reviews and edits; these are a starting point, not a substitute for looking at the account.
 */
const BODY: Record<TicketCategory, { text: string; citations: string[] }> = {
  ROYALTY_PAYMENTS: {
    citations: ["kb.royalty-policy"],
    text: "Thank you for reaching out, and I'm sorry for the worry this has caused. Royalties are calculated quarterly and paid within 45 days of the quarter ending, by bank transfer to the account linked in your dashboard. If accumulated royalties are below ₹1,000, they roll over to the next quarter. Net profit is the MRP minus printing cost, platform commission and shipping charges, and your dashboard shows a detailed royalty breakdown with sales figures per platform. Our team will review your account and follow up with the details for your book. In the meantime, please check that your bank details are linked in your dashboard."
  },
  ISBN_METADATA: {
    citations: ["kb.isbn-policy"],
    text: "Thank you for flagging this, and I'm sorry for the concern. Every book published through BookLeaf receives a unique ISBN assigned by BookLeaf, registered under our publisher imprint. If an ISBN is wrong, such as a duplicate or linked to the wrong book, we treat it as a high-priority issue and escalate it to the production team. Our team will look into this and follow up with you. To help us, please reply with the ISBN shown on the platform and the one on your physical copy."
  },
  PRINTING_QUALITY: {
    citations: ["kb.printing-quality"],
    text: "I'm sorry your copies did not meet the standard you should expect from us. If there are misprints, binding defects or color inconsistency, BookLeaf arranges a free reprint after verification. Standard print turnaround is 5–7 business days from order confirmation. To verify, please reply with photos of the defective copy. Our team will follow up with you once we have them."
  },
  DISTRIBUTION_AVAILABILITY: {
    citations: ["kb.distribution-availability"],
    text: "Thank you for letting us know, and I'm sorry for the trouble. Books are listed on Amazon India, Flipkart, Amazon US, Amazon UK and the BookLeaf Store, and new listings typically go live within 7–10 business days after publication is complete. If a book shows as unavailable on a platform, it usually indicates a stock sync issue, and our team can trigger a re-sync within 24–48 hours. Our team will look into your listing and follow up with you. Please reply with the platform and a link-free description of what you see, such as the exact message shown."
  },
  BOOK_STATUS_PRODUCTION: {
    citations: ["kb.production-stages"],
    text: "Thank you for your patience, and I understand you want a clear update. A book goes through these stages: Manuscript Received → Editing (if opted) → Cover Design → Typesetting → Proofreading → ISBN Assignment → Printing → Distribution Setup → Published & Live. Delays typically happen at Cover Design, while we wait for approval, and at Proofreading, during revision rounds. Our team will check where your book is now and follow up with its current status and next step."
  },
  GENERAL_INQUIRY: {
    citations: ["kb.company-overview"],
    text: "Thank you for getting in touch. BookLeaf handles cover design, typesetting, ISBN assignment, printing, distribution and royalty management for our authors. Our team will review your message and follow up with you. If there is anything specific, such as the book it concerns, please reply with the details so we can help faster."
  }
};

export function fallbackDraft(category: TicketCategory, firstName: string): { draft: string; citations: string[] } {
  const { text, citations } = BODY[category];
  return { draft: `Dear ${firstName},\n\n${text}\n\nWarm regards,\nBookLeaf Author Support`, citations: [...citations] };
}

/** First name for the greeting. Conservative on purpose: anything unusual becomes the neutral "Author". */
export function greetingName(authorContext: Record<string, unknown> | undefined): string {
  const name = authorContext?.name;
  if (typeof name !== "string") return "Author";
  const first = name.trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}][\p{L}'’-]{0,29}$/u.test(first) ? first : "Author";
}
