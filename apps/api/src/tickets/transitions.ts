import type { TicketStatus } from "@bookleaf/db";

/**
 * Allowed admin status transitions. The architecture docs name the four statuses but define no transition table, so this
 * is the backend's documented assumption (reported to the controller): work moves forward, RESOLVED can be reopened,
 * and CLOSED is terminal. Change the table here; nothing else encodes the rules.
 */
export const allowedTransitions: Record<TicketStatus, readonly TicketStatus[]> = {
  OPEN: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["OPEN", "RESOLVED", "CLOSED"],
  RESOLVED: ["OPEN", "IN_PROGRESS", "CLOSED"],
  CLOSED: []
};

export const canTransition = (from: TicketStatus, to: TicketStatus): boolean => allowedTransitions[from].includes(to);

/** Unresolved tickets are those still needing admin attention. */
export const unresolvedStatuses: readonly TicketStatus[] = ["OPEN", "IN_PROGRESS"];
