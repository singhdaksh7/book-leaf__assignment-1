import { Router } from "express";
import { bookListResponseSchema, ticketFilterSchema } from "@bookleaf/contracts";
import type { PrismaClient } from "@bookleaf/db";
import { authorProfileId, requireAuthor } from "../auth/middleware.js";
import { asyncHandler, parseInput } from "../http/validate.js";
import { serializeBook } from "../serializers.js";

/** Book requests accept pagination only; unknown query keys are rejected rather than silently ignored. */
const bookQuerySchema = ticketFilterSchema.pick({ page: true, pageSize: true }).strict();

export function createAuthorRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuthor);

  router.get("/books", asyncHandler(async (req, res) => {
    const { page, pageSize } = parseInput(bookQuerySchema, req.query, "query");
    // The authenticated profile id is the only scope; no client-supplied author id exists on this route.
    const where = { authorId: authorProfileId(req) };
    const [total, books] = await Promise.all([
      prisma.book.count({ where }),
      prisma.book.findMany({ where, orderBy: [{ externalBookId: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize })
    ]);
    res.status(200).json(bookListResponseSchema.parse({ items: books.map(serializeBook), page, pageSize, total }));
  }));

  return router;
}
