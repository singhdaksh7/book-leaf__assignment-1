# Seed data

The original PDF and JSON remain unchanged in ignored `reference/`. The local copy `data/bookleaf_sample_data.json` is also ignored because it contains confidential personal and royalty information. Do not track it until the owner verifies repository visibility and explicit publication permissions. Never modify or publish the original reference files.

## Pending backend implementation

The backend/database owner will create `packages/db/prisma/seed.ts` and then add a working `seed` script to `@bookleaf/db`. The broken command has been removed; no seed is available now.

- Resolve `BOOKLEAF_SEED_DATA_PATH` explicitly or default to `data/bookleaf_sample_data.json` relative to the repository, not the caller's working directory. This environment variable is planned, not implemented.
- Read the ignored local file at runtime; do not import JSON into a bundle, embed records in code, or copy data from `reference/` automatically.
- Validate the full dataset before writing. Preserve every source field, external identifier, integer royalty/copy value, date, empty array, zero, and `null`. Do not invent or recalculate royalty data.
- Upsert using unique external IDs in a transaction, with explicit local credential configuration and password hashing. Re-running must not duplicate authors/books or reset existing passwords silently. Credentials are separate from the supplied dataset.
- Fail clearly for missing/invalid input without logging record contents. Report only aggregate counts. Instantiate and disconnect Prisma explicitly.
- Test with separately authored synthetic fixtures. A synthetic demo dataset may be committed only if it contains no copied names, contacts, or financial records. It must be labeled synthetic and must not replace the reference originals.

Local seeding requires PostgreSQL, migrations, and backend implementation. The import should never require staging the confidential dataset.
