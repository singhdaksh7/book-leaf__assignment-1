/**
 * The explicit list of synthetic test identities. Both the production seed guard and the cleanup tool use it, so
 * "what counts as synthetic" is defined in exactly one place. A record is synthetic only when its email AND its
 * external ids agree; anything else is treated as potentially real and is never touched by the cleanup tool.
 */
export const SYNTHETIC_AUTHOR_EMAILS: readonly string[] = [
  "synthetic.author1@example.test",
  "synthetic.author2@example.test",
  "synthetic.author3@example.test",
  "synthetic.author4@example.test",
  "synthetic.author5@example.test",
  "synthetic.author6@example.test",
  "synthetic.author7@example.test",
  "synthetic.author8@example.test",
  "synthetic.author9@example.test",
  "synthetic.author10@example.test"
];

export const SYNTHETIC_AUTHOR_ID = /^SYN-A\d{3}$/;
export const SYNTHETIC_BOOK_ID = /^SYN-B\d{3}$/;

/** Value of BOOKLEAF_ALLOW_SYNTHETIC_SEED that lets the synthetic seed run with NODE_ENV=production. */
export const SYNTHETIC_SEED_ACK = "yes-i-understand";
