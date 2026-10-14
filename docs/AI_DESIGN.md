# AI design

## Provider boundary

Phase 1 supplies the `AiService` interface and schemas only. Provider calls, retrieval, persistence mapping, retries, and review UI remain implementation work for their respective owners.

`packages/ai` exposes an `AiService.analyzeTicket()` interface rather than coupling routes to OpenRouter. The OpenRouter adapter uses server-side `OPENROUTER_API_KEY` and configured model only; neither is sent to `apps/web`. OpenRouter is selected to permit a low-cost compatible model and controlled fallback model, while keeping an adapter boundary for replacement.

## Grounding and structured output

The knowledge base is versioned/chunked by: company overview/packages; royalty policy; ISBN policy; printing/quality; distribution/availability; production stages; tone; examples. Retrieval selects the category-relevant chunks and policy snippets, not the whole knowledge base. The prompt includes ticket subject/body, only relevant book status/royalty fields, and compact recent conversation context.

The model must return JSON validated by `aiAnalysisSchema`: exact category enum, exact priority enum, 0-1 confidence, short rationale, author-ready draft, `requiresHumanReview: true`, and `knowledgeBaseCitations` containing retrieved policy citation IDs. False review flags, invalid JSON, and unsupported enum values are rejected. The adapter must also check citations against the retrieved chunks and reject unsupported factual claims; schema validation alone cannot prove grounding.

`AiService.analyzeTicket()` returns `TicketAiAnalysis`, a completed payload. Pending/failed HTTP resources use the distinct `aiAnalysisAttemptSchema`. Backend mapping stores result fields on `AiAnalysis` and maps API `knowledgeBaseCitations` to database `citations` (JSON string array), then reverses that mapping on read. `requiresHumanReview` is a fixed API policy of literal `true`, not a persisted field; it cannot be disabled by a model or by confidence. Exact state/null invariants are documented in `DATABASE_SCHEMA.md`. The AI package must not import Prisma or implement persistence.

## Policy facts the draft may use

- BookLeaf is a self-publishing publisher operating in India and the US. It handles cover design, typesetting, ISBN, printing, distribution and royalties. Standard Free has no upfront cost; Bestseller Breakthrough is paid with marketing/distribution add-ons. Its in-house print facility/warehouse is in Delhi; Repro India and Epitome Books are print partners.
- Royalty split is 80% author / 20% BookLeaf of net profit; net profit subtracts printing, platform commission and shipping. Royalties are quarterly, paid within 45 days, with a ₹1,000 rollover threshold and bank transfer to dashboard-linked account.
- BookLeaf assigns a unique ISBN under its imprint. An incorrect/duplicate/wrong-linked ISBN is high priority, escalated to production, with a 48-hour timeline.
- Print turnaround is 5-7 business days. Verified misprints/binding/color issues get a free reprint; request photos where needed.
- Listings are Amazon India, Flipkart, Amazon US/UK and BookLeaf Store. New listing: 7-10 business days after publication; unavailable stock sync: re-sync within 24-48 hours.
- Production: Manuscript Received -> Editing (if opted) -> Cover Design -> Typesetting -> Proofreading -> ISBN Assignment -> Printing -> Distribution Setup -> Published & Live. Delays commonly involve cover approval and revision rounds.
- Metadata changes after publication may be submitted through the dashboard or BookLeaf team and typically take 3-5 business days to reflect on platforms.

Drafts must be empathetic/professional, acknowledge concern, state known numbers/statuses/dates, own BookLeaf failures, provide a bounded escalation timeline, and end with a next step. It must not invent an investigation result, payout date, account state, or policy.

## Reliability, review and cost

Ticket creation commits first. AI attempts use timeouts/retries with bounded exponential backoff; rate-limit/provider/network/validation failure leaves an `AiAnalysis` with safe status and does not block admin manual classification or response. A manual admin review is mandatory before any draft is sent. Admin changes are audited.

Cost controls: compact retrieved chunks; include only relevant record fields; cap history and output; one analysis per new/meaningfully changed ticket unless manually refreshed; store output/usage/cost; cache stable policy chunks; use a configured inexpensive primary model and optional fallback only on safe retry conditions. Never expose raw prompts containing personal data in client telemetry.
