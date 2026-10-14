import type { TicketCategory } from "../categories.js";

export type ChunkKind = "overview" | "policy" | "tone" | "example";

export interface KbChunk {
  id: string;
  topic: string;
  kind: ChunkKind;
  /** Categories this chunk is primarily evidence for. */
  categories: readonly TicketCategory[];
  /** Lower-case stems used by the keyword retriever. */
  keywords: readonly string[];
  /** Policy text, transcribed from the BookLeaf assignment Knowledge Base. Do not paraphrase. */
  content: string;
}

/** Bump when any chunk text changes so stored citations can be traced to a policy version. */
export const KB_VERSION = "bookleaf-assignment-kb-v1";

export const KB_CHUNKS: readonly KbChunk[] = [
  {
    id: "kb.company-overview", topic: "Company Overview", kind: "overview", categories: ["GENERAL_INQUIRY"],
    keywords: ["package", "standard free", "bestseller", "breakthrough", "delhi", "repro", "epitome", "warehouse", "publish", "cover design", "typesetting", "account", "author bio", "bio"],
    content: [
      "BookLeaf Publishing is a self-publishing company operating in India and the US.",
      "We offer publishing packages: Standard Free (no upfront cost) and Bestseller Breakthrough (premium, paid package with marketing and distribution add-ons).",
      "We handle cover design, typesetting, ISBN assignment, printing, distribution, and royalty management for our authors.",
      "Our in-house printing facility and warehouse are located in Delhi. We also work with print partners including Repro India and Epitome Books."
    ].join("\n")
  },
  {
    id: "kb.royalty-policy", topic: "Royalty Policy", kind: "policy", categories: ["ROYALTY_PAYMENTS"],
    keywords: ["royalt", "payout", "payment", "paid", "pay ", "bank", "transfer", "quarter", "net profit", "commission", "threshold", "rollover", "earn", "80/20", "split", "breakdown", "money", "amount"],
    content: [
      "BookLeaf follows an 80/20 royalty split: 80% of the net profit per book goes to the author, 20% to BookLeaf.",
      "Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart), and shipping charges.",
      "Royalties are calculated quarterly and paid within 45 days of the quarter ending.",
      "Minimum payout threshold: ₹1,000. If accumulated royalties are below this, they roll over to the next quarter.",
      "Payouts are made via bank transfer to the account linked in the author's dashboard.",
      "Authors can view a detailed royalty breakdown in their dashboard, showing sales figures per platform."
    ].join("\n")
  },
  {
    id: "kb.isbn-policy", topic: "ISBN Policy", kind: "policy", categories: ["ISBN_METADATA"],
    keywords: ["isbn", "imprint", "metadata", "duplicate", "wrong book", "barcode", "description", "title change", "listing details", "cover price"],
    content: [
      "Every book published through BookLeaf receives a unique ISBN assigned by BookLeaf.",
      "ISBNs are registered under BookLeaf's publisher imprint. If an author wants an ISBN under their own imprint, they need to obtain it independently.",
      "If an author reports an ISBN error (duplicate, wrong book linked), it is treated as a high-priority issue and escalated to the production team."
    ].join("\n")
  },
  {
    id: "kb.printing-quality", topic: "Printing & Quality", kind: "policy", categories: ["PRINTING_QUALITY"],
    keywords: ["print", "quality", "misprint", "binding", "blurry", "misaligned", "colo", "defect", "reprint", "damaged", "torn", "author cop", "turnaround", "paper", "faded"],
    content: [
      "In-house printing handles most orders. Overflow or specific format requirements go to Repro India or Epitome Books.",
      "Standard print turnaround: 5–7 business days from order confirmation.",
      "If an author reports a quality issue (misprints, binding defects, color inconsistency), BookLeaf arranges a free reprint after verification. The author may need to share photos of the defective copy."
    ].join("\n")
  },
  {
    id: "kb.distribution-availability", topic: "Distribution & Availability", kind: "policy", categories: ["DISTRIBUTION_AVAILABILITY"],
    keywords: ["amazon", "flipkart", "listing", "listed", "unavailable", "out of stock", "stock", "not showing", "available", "store", "distribut", "platform", "go live", "sync", "buy"],
    content: [
      "Books are listed on Amazon India, Flipkart, Amazon US, Amazon UK, and the BookLeaf Store.",
      "New listings typically go live within 7–10 business days after publication is complete.",
      "If a book is showing as unavailable on a platform, it usually indicates a stock sync issue—BookLeaf's team can trigger a re-sync within 24–48 hours."
    ].join("\n")
  },
  {
    id: "kb.production-stages", topic: "Production Stages", kind: "policy", categories: ["BOOK_STATUS_PRODUCTION"],
    keywords: ["status", "stage", "production", "typesetting", "proofread", "proof", "editing", "manuscript", "cover design", "delay", "when will", "how long", "progress", "update", "weeks", "approval", "revision"],
    content: [
      "A book goes through the following stages: Manuscript Received → Editing (if opted) → Cover Design → Typesetting → Proofreading → ISBN Assignment → Printing → Distribution Setup → Published & Live.",
      "Authors are updated at each stage via email. Delays typically happen at Cover Design (waiting for author approval) and Proofreading (revision rounds)."
    ].join("\n")
  },
  {
    id: "kb.tone-guidelines", topic: "Communication Tone Guidelines", kind: "tone", categories: [], keywords: [],
    content: [
      "Always empathetic and professional. Authors are our partners, not customers to be managed.",
      "Acknowledge the author's concern before jumping to solutions.",
      "Be specific: include actual numbers, dates, and statuses wherever possible rather than vague reassurances.",
      "If something is BookLeaf's fault (delayed royalties, ISBN error), own it directly. No corporate deflection.",
      "If the issue requires escalation or investigation, give a clear timeline (\"Our team will look into this and get back to you within 48 hours\") rather than open-ended promises.",
      "Always end with a clear next step for the author and/or the BookLeaf team."
    ].join("\n")
  },
  example("royalty-not-received", "ROYALTY_PAYMENTS", ["royalt", "haven't received", "not received", "months"],
    "I published my book 4 months ago and still haven't received any royalty. What's going on?",
    "Acknowledge the frustration. Explain the quarterly royalty cycle and 45-day payout window. Check if their bank details are linked. Provide the specific next payout date. If the payment is genuinely overdue, escalate with a 48-hour resolution timeline."),
  example("royalty-too-low", "ROYALTY_PAYMENTS", ["royalt", "too low", "copies", "amount"],
    "My royalty amount seems too low. I sold 200 copies but only received 3,000.",
    "Explain the net profit calculation: MRP minus printing, platform commission, and shipping. Offer to share a detailed line-by-line royalty breakdown. Don't be defensive—offer transparency."),
  example("isbn-mismatch", "ISBN_METADATA", ["isbn", "different", "physical copy"],
    "My book is showing a different ISBN on Amazon than what's on the physical copy.",
    "Treat as high priority. Acknowledge this is a serious data issue. Confirm you are escalating to the production team immediately. Provide a 48-hour resolution timeline."),
  example("print-quality", "PRINTING_QUALITY", ["print", "blurry", "misaligned", "terrible"],
    "I received my author copies and the print quality is terrible. The images are blurry and pages are misaligned.",
    "Apologise sincerely. Ask the author to share photos of the defective copies. Confirm that BookLeaf will arrange a free reprint once verified. Provide a timeline of 5–7 business days for the reprint."),
  example("currently-unavailable", "DISTRIBUTION_AVAILABILITY", ["unavailable", "amazon", "currently unavailable"],
    "My book is published but it's showing as \"Currently Unavailable\" on Amazon.",
    "Explain that this is typically a stock sync issue. Confirm you're triggering a re-sync with the distribution team. Set expectation: 24–48 hours for it to go live again."),
  example("typesetting-delay", "BOOK_STATUS_PRODUCTION", ["typesetting", "weeks", "when will"],
    "It's been 3 weeks and my book is still in typesetting. When will it be done?",
    "Check the actual production status. If it's delayed, be honest about why (e.g., waiting on author approval for proofs). Provide a specific updated timeline. Don't blame the author even if the delay is on their side—frame it collaboratively."),
  example("metadata-update", "GENERAL_INQUIRY", ["description", "update", "amazon", "already live", "metadata"],
    "Can I update the description of my book on Amazon after it's already live?",
    "Yes, metadata updates can be submitted through the dashboard or by emailing the BookLeaf team. Changes typically reflect on platforms within 3–5 business days.")
];

function example(slug: string, category: TicketCategory, keywords: string[], query: string, expected: string): KbChunk {
  return {
    id: `kb.example.${slug}`, topic: `Sample Query → Response Example (${category})`, kind: "example", categories: [category], keywords,
    content: `Sample Author Query: ${query}\nExpected Response Tone & Content: ${expected}`
  };
}
