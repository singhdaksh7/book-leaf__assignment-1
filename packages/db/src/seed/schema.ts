import { z } from "zod";

// Field names mirror the supplied dataset exactly. Strict objects: an unexpected field fails loudly instead of being dropped.
const count = z.number().int().min(0);
const dateOnly = z.string().date();

export const seedBookSchema = z.object({
  book_id: z.string().min(1),
  title: z.string(),
  isbn: z.string(),
  genre: z.string(),
  publication_date: dateOnly.nullable(),
  status: z.string(),
  mrp: count.nullable(),
  author_royalty_per_copy: count.nullable(),
  total_copies_sold: count,
  total_royalty_earned: count,
  royalty_paid: count,
  royalty_pending: count,
  last_royalty_payout_date: dateOnly.nullable(),
  print_partner: z.string().nullable(),
  available_on: z.array(z.string())
}).strict();

export const seedAuthorSchema = z.object({
  author_id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string(),
  city: z.string(),
  joined_date: dateOnly,
  books: z.array(seedBookSchema)
}).strict();

export const seedDatasetSchema = z.array(seedAuthorSchema).min(1);

export type SeedBook = z.infer<typeof seedBookSchema>;
export type SeedAuthor = z.infer<typeof seedAuthorSchema>;
export type SeedDataset = z.infer<typeof seedDatasetSchema>;
