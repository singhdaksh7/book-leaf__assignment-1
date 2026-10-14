import type { TicketAiAnalysis } from "@bookleaf/contracts";

export interface KnowledgeBaseChunk { id: string; topic: string; content: string; }
export interface AnalyzeTicketInput { ticketId: string; subject: string; description: string; authorContext: Record<string, unknown>; bookContext?: Record<string, unknown>; history?: Array<{ author: "AUTHOR" | "ADMIN"; body: string }>; knowledge: KnowledgeBaseChunk[]; }
export interface AiService { analyzeTicket(input: AnalyzeTicketInput): Promise<TicketAiAnalysis>; }
export class AiUnavailableError extends Error { constructor(message = "AI service is unavailable") { super(message); this.name = "AiUnavailableError"; } }
