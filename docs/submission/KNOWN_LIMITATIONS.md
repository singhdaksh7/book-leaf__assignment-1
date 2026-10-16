# Known limitations

* **Real AI verified with limits.** On the default free model, classification was 6/6 correct and drafts passed the grounding check in 12 of 13 analyses after prompt hardening (3/6 before); the sample is small and non-deterministic, so expect an occasional labelled rule-based fallback. The Gemma alternative was rate limited upstream. Free models may log prompts and are rate limited (20/min, 50/day documented without credits). The validator cannot judge semantic quality; human review is required (and enforced).
* **The 48-hour wording** in the knowledge-base tone guideline and royalty example is unverified as a company commitment. The AI is told not to repeat it; add it to a policy chunk if it is real.
* **Real AI on the live site is unverified:** the free daily quota (50 requests, about 25 analyses) was exhausted during acceptance; attempts were recorded `AI_RATE_LIMITED` with no mock or paid fallback. Re-run `tests/live/real-ai-smoke.mjs` after the quota resets (see `docs/release/DEPLOYMENT_RECORD.md`).
* **Backups:** installed and scheduled, restore of a live-database backup proven in isolation, but **no off-host copy** (disaster recovery incomplete) and the first scheduled run is not yet observed.
* **Host risks:** a daily host cron prunes unused Docker images older than 24 h (rollback images are protected by anchor containers, not by changing the cron); reboot and security updates pending; the deployed tree is not a git checkout.
* **Deferred defects:** duplicate tickets on concurrent identical submissions; admin search covers the current page only; liveness-only health check; internal-note/assignment deletion not trigger-protected (needs a migration).
* **Not implemented:** password reset, e-mail notifications, attachment deletion, server-side search.
* **Registration:** reveals whether an address is registered (no e-mail verification); self-registered authors start with no books and there is no screen to link books yet; registration throttling is per process.
* **Release state:** self-registration and the cleanup tool are implemented and tested locally but not deployed; the live database still holds the synthetic records until the separately approved cleanup is run.
* Login throttling and AI single-flight are per process (single API instance).
* Rule-based fallback labelling lives in the rationale text because persisting a quality field needs a migration.

Full detail: `docs/KNOWN_LIMITATIONS.md`, `docs/architecture/17-KNOWN-LIMITATIONS.md`.
