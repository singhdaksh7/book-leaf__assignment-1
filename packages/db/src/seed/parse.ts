import { seedDatasetSchema, type SeedDataset } from "./schema.js";

/** Raised for bad input. Messages carry field paths and counts only, never record values. */
export class SeedValidationError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "SeedValidationError";
    this.issues = issues;
  }
}

/** Accepts a top-level array of authors or an object wrapping it as `authors`. */
export function parseSeedDataset(raw: unknown): SeedDataset {
  const candidate = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? (raw as { authors?: unknown }).authors : undefined);
  const parsed = seedDatasetSchema.safeParse(candidate);
  if (!parsed.success) {
    // Path + code only: zod messages can echo received values.
    const issues = parsed.error.issues.slice(0, 20).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`);
    throw new SeedValidationError(`Seed data failed validation (${parsed.error.issues.length} issue(s))`, issues);
  }
  const dataset = parsed.data;
  assertUnique(dataset.map((a) => a.author_id), "author_id");
  assertUnique(dataset.map((a) => a.email.trim().toLowerCase()), "author email");
  assertUnique(dataset.flatMap((a) => a.books.map((b) => b.book_id)), "book_id");
  return dataset;
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new SeedValidationError(`Seed data contains duplicate ${label} values`);
}
