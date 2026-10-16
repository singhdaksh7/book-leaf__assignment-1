# Reviewer guide

1. **Honesty first.** `docs/release/01-CURRENT-STATE.md` states what was run and what was not. Real OpenRouter inference is only **partially** verified (see `docs/release/AI_REAL_PROVIDER.md`: classification 6/6 correct, drafts 3/6 accepted on the alternative free model; the default model was rate limited upstream); the automated suites use mock providers. The staging site currently runs the demonstration mock, whose outputs are labelled `[DEMO MOCK]` / `[DEMO DRAFT]`.
2. **Read the code in this order:** `packages/contracts/src/index.ts` (shared Zod schemas), `packages/db/prisma/schema.prisma`, `apps/api/src/{auth,tickets,attachments,events,ai}`, `packages/ai/src` (classifier, drafter, safety, grounding, provider), `apps/web/src`.
3. **Security to try:** log in as one author and request another author's ticket id (expect 404, identical to a missing one); call a state-changing endpoint without `X-CSRF-Token` (403); send `<script>` in a ticket body (rendered as text); upload a disguised file type (rejected).
4. **AI to try:** open a ticket as admin, read the analysis (category, priority, rationale, cited policy chunks, draft), edit the draft, send it as a normal reply. A rationale that begins "[Rule-based fallback" means the model output was not usable and templates were used.
5. **Tests:** see TEST_RESULTS.md.
6. **Live-provider test:** `node tests/live/ai-real.mjs` after placing a key in `infra/.env` (see `docs/release/AI_REAL_PROVIDER.md`).
