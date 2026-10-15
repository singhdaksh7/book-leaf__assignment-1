/**
 * Extension points for later milestones (AI analysis queue, SSE fan-out). Hooks run after the database transaction has
 * committed and must never affect the HTTP outcome: errors are caught and logged by the caller.
 */
export interface TicketHooks {
  /** Called once a ticket is durably stored. The AI analysis integration attaches here; it must only enqueue. */
  onTicketCreated?(ticket: { id: string; authorId: string }): Promise<void> | void;
}
