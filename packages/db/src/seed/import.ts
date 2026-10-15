import type { Prisma, PrismaClient } from "@prisma/client";
import { hashPassword } from "../password.js";
import type { SeedDataset } from "./schema.js";

export interface SeedCredentials {
  /** Shared local/demo password for newly created author logins. Credentials are not part of the supplied dataset. */
  authorPassword: string;
  adminEmail?: string;
  adminPassword?: string;
  /** Only when true are existing users' password hashes replaced. Default: existing passwords are left alone. */
  resetPasswords?: boolean;
}

export interface SeedOptions {
  credentials: SeedCredentials;
  hash?: (password: string) => Promise<string>;
}

export interface SeedSummary {
  authors: number;
  books: number;
  usersCreated: number;
  adminCreated: boolean;
  passwordsReset: number;
}

export const MIN_SEED_PASSWORD_LENGTH = 12;

export class SeedConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedConflictError";
  }
}

const toDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const toDateOrNull = (value: string | null): Date | null => (value === null ? null : toDate(value));
export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Idempotent, transactional import. Source values (including nulls, zeros and empty arrays) are written unchanged;
 * nothing is recomputed. Re-running updates source-owned fields, never creates duplicates and, unless
 * `resetPasswords` is set, never changes an existing password. Logs nothing; returns aggregate counts only.
 */
export async function importSeedData(prisma: PrismaClient, dataset: SeedDataset, options: SeedOptions): Promise<SeedSummary> {
  const { credentials } = options;
  const hash = options.hash ?? ((password: string) => hashPassword(password));
  if (credentials.authorPassword.length < MIN_SEED_PASSWORD_LENGTH) throw new SeedConflictError(`Seed author password must be at least ${MIN_SEED_PASSWORD_LENGTH} characters`);
  const adminEmail = credentials.adminEmail ? normaliseEmail(credentials.adminEmail) : undefined;
  if (adminEmail && (!credentials.adminPassword || credentials.adminPassword.length < MIN_SEED_PASSWORD_LENGTH)) {
    throw new SeedConflictError(`Seed admin password must be at least ${MIN_SEED_PASSWORD_LENGTH} characters`);
  }
  if (adminEmail && dataset.some((a) => normaliseEmail(a.email) === adminEmail)) throw new SeedConflictError("Seed admin email collides with an author email");

  const emails = dataset.map((a) => normaliseEmail(a.email));
  const existingUsers = await prisma.user.findMany({ where: { email: { in: adminEmail ? [...emails, adminEmail] : emails } }, select: { email: true } });
  const existing = new Set(existingUsers.map((u) => u.email));
  const reset = credentials.resetPasswords === true;

  // Hash outside the transaction: Argon2 is deliberately slow. One salted hash per account.
  const needsHash = (email: string) => reset || !existing.has(email);
  const authorHashes = new Map<string, string>();
  for (const email of emails) if (needsHash(email)) authorHashes.set(email, await hash(credentials.authorPassword));
  const adminHash = adminEmail && needsHash(adminEmail) ? await hash(credentials.adminPassword as string) : undefined;

  return prisma.$transaction(async (tx) => {
    const summary: SeedSummary = { authors: 0, books: 0, usersCreated: 0, adminCreated: false, passwordsReset: 0 };

    if (adminEmail) {
      const admin = await tx.user.findUnique({ where: { email: adminEmail } });
      if (!admin) {
        await tx.user.create({ data: { email: adminEmail, passwordHash: adminHash as string, role: "ADMIN" } });
        summary.adminCreated = true;
      } else {
        if (admin.role !== "ADMIN") throw new SeedConflictError("Seed admin email belongs to a non-admin user");
        if (reset) {
          await tx.user.update({ where: { id: admin.id }, data: { passwordHash: adminHash as string } });
          summary.passwordsReset += 1;
        }
      }
    }

    for (const author of dataset) {
      const email = normaliseEmail(author.email);
      const profileData = { name: author.name, phone: author.phone, city: author.city, joinedDate: toDate(author.joined_date) };

      const profile = await tx.authorProfile.findUnique({ where: { externalAuthorId: author.author_id }, include: { user: true } });
      if (profile && profile.user.email !== email) throw new SeedConflictError("An existing author profile is linked to a different login email");
      let user = profile?.user ?? (await tx.user.findUnique({ where: { email } }));

      if (!user) {
        user = await tx.user.create({ data: { email, passwordHash: authorHashes.get(email) as string, role: "AUTHOR" } });
        summary.usersCreated += 1;
      } else {
        if (user.role !== "AUTHOR") throw new SeedConflictError("A seed author email belongs to a non-author user");
        if (reset) {
          await tx.user.update({ where: { id: user.id }, data: { passwordHash: authorHashes.get(email) as string } });
          summary.passwordsReset += 1;
        }
      }

      const saved = await tx.authorProfile.upsert({
        where: { externalAuthorId: author.author_id },
        create: { ...profileData, externalAuthorId: author.author_id, userId: user.id },
        update: profileData
      });
      summary.authors += 1;

      for (const book of author.books) {
        const data: Omit<Prisma.BookUncheckedCreateInput, "externalBookId" | "authorId"> = {
          title: book.title, isbn: book.isbn, genre: book.genre, publicationDate: toDateOrNull(book.publication_date), status: book.status,
          mrp: book.mrp, authorRoyaltyPerCopy: book.author_royalty_per_copy, totalCopiesSold: book.total_copies_sold,
          totalRoyaltyEarned: book.total_royalty_earned, royaltyPaid: book.royalty_paid, royaltyPending: book.royalty_pending,
          lastRoyaltyPayoutDate: toDateOrNull(book.last_royalty_payout_date), printPartner: book.print_partner, availableOn: book.available_on
        };
        const current = await tx.book.findUnique({ where: { externalBookId: book.book_id }, select: { authorId: true } });
        if (current && current.authorId !== saved.id) throw new SeedConflictError("An existing book is owned by a different author");
        await tx.book.upsert({
          where: { externalBookId: book.book_id },
          create: { ...data, externalBookId: book.book_id, authorId: saved.id },
          update: data
        });
        summary.books += 1;
      }
    }
    return summary;
  }, { timeout: 120_000, maxWait: 10_000 });
}
