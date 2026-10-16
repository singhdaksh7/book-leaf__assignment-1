import type { Request } from "express";
import { ticketFilterSchema } from "@bookleaf/contracts";
import type { TicketFilter } from "@bookleaf/contracts";
import type { Prisma } from "@bookleaf/db";
import { validationError } from "../http/errors.js";
import { parseInput } from "../http/validate.js";

/** Strict: unknown keys (e.g. authorId) are rejected so a filter can never widen or redirect the tenant scope. */
const strictFilterSchema = ticketFilterSchema.strict();
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseTicketFilter(req: Request): TicketFilter {
  const filter = parseInput(strictFilterSchema, req.query, "query");
  // A date-only `to` (YYYY-MM-DD) means "through the end of that day", so the bound is inclusive as documented.
  if (typeof req.query.to === "string" && dateOnlyPattern.test(req.query.to) && filter.to) {
    filter.to = new Date(filter.to.getTime() + 86_400_000 - 1);
  }
  if (filter.from && filter.to && filter.from > filter.to) throw validationError("Invalid query", [{ path: "from", message: "from must not be after to" }]);
  return filter;
}

/** Filter predicates only. Callers add the tenant scope themselves, outside user input. */
export function filterWhere(filter: TicketFilter): Prisma.TicketWhereInput {
  return {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.category ? { category: filter.category } : {}),
    ...(filter.priority ? { priority: filter.priority } : {}),
    ...(filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {})
  };
}
