import type { PrismaClient } from "@bookleaf/db";

export class DatabaseEncodingError extends Error {
  constructor(readonly encoding: string) {
    super(`PostgreSQL server_encoding is ${encoding}; the database must be created with UTF8 (author names and rupee signs do not fit other encodings)`);
    this.name = "DatabaseEncodingError";
  }
}

/**
 * Fails fast at startup if the database cannot store arbitrary Unicode. A non-UTF8 database (the default on some Windows
 * installs) silently works for ASCII and then rejects the first non-ASCII author name or rupee sign at runtime.
 */
export async function assertUtf8Database(prisma: Pick<PrismaClient, "$queryRaw">): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ server_encoding: string }>>`SHOW server_encoding`;
  const encoding = rows[0]?.server_encoding ?? "unknown";
  if (encoding.toUpperCase() !== "UTF8") throw new DatabaseEncodingError(encoding);
}
