import { authorProfileSchema, bookSchema, currentUserSchema } from "@bookleaf/contracts";
import type { AuthorProfile as WireAuthorProfile, Book as WireBook, CurrentUser } from "@bookleaf/contracts";
import type { AuthorProfile, Book } from "@bookleaf/db";
import type { AuthContext } from "./http/types.js";
import { toDateOnly, toDateOnlyOrNull } from "./http/serialize.js";

// Every DTO is built field by field and then parsed: relations and private columns can never leak by spreading.

export function serializeAuthorProfile(profile: AuthorProfile): WireAuthorProfile {
  return authorProfileSchema.parse({
    id: profile.id, userId: profile.userId, externalAuthorId: profile.externalAuthorId,
    name: profile.name, phone: profile.phone, city: profile.city, joinedDate: toDateOnly(profile.joinedDate)
  });
}

export function serializeCurrentUser(auth: AuthContext): CurrentUser {
  return currentUserSchema.parse({
    id: auth.user.id, email: auth.user.email, role: auth.user.role,
    authorProfile: auth.authorProfile ? serializeAuthorProfile(auth.authorProfile) : null
  });
}

/** Source nulls stay null; zeros and empty `availableOn` pass through untouched. */
export function serializeBook(book: Book): WireBook {
  return bookSchema.parse({
    id: book.id, externalBookId: book.externalBookId, authorId: book.authorId, title: book.title, isbn: book.isbn, genre: book.genre,
    publicationDate: toDateOnlyOrNull(book.publicationDate), status: book.status, mrp: book.mrp,
    authorRoyaltyPerCopy: book.authorRoyaltyPerCopy, totalCopiesSold: book.totalCopiesSold, totalRoyaltyEarned: book.totalRoyaltyEarned,
    royaltyPaid: book.royaltyPaid, royaltyPending: book.royaltyPending, lastRoyaltyPayoutDate: toDateOnlyOrNull(book.lastRoyaltyPayoutDate),
    printPartner: book.printPartner, availableOn: book.availableOn
  });
}
