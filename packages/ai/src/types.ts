import type { TicketAiAnalysis } from "@bookleaf/contracts";

export interface KnowledgeBaseChunk { id: string; topic: string; content: string; }
/**
 * `authorContext` is accepted for interface compatibility but is never sent to the model (PII).
 * `knowledge` is optional: when omitted the package retrieves from its built-in BookLeaf knowledge base.
 */
export interface AnalyzeTicketInput {
  ticketId: string; subject: string; description: string;
  authorContext: Record<string, unknown>; bookContext?: Record<string, unknown>;
  history?: Array<{ author: "AUTHOR" | "ADMIN"; body: string }>;
  knowledge?: KnowledgeBaseChunk[];
}
export interface AiService { analyzeTicket(input: AnalyzeTicketInput): Promise<TicketAiAnalysis>; }
