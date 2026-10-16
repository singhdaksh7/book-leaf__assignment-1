# Known limitations

* **Real AI verified locally, with limits.** Real OpenRouter calls on the default free model: classification and priority 6/6 in each of the last three runs; the model draft passed strict grounding for 5 of 6 tickets each time (the book-status draft is rejected because the model invents a timeline, so a labelled policy-template draft is shown). Small, non-deterministic sample.
* **The 48-hour wording** in the knowledge-base tone guideline and royalty example is unverified as a company commitment. The AI is told not to repeat it; add it to a policy chunk if it is real.
* **Real AI on the live site was not demonstrated:** the key's free daily quota (50 requests, about 25 analyses) was exhausted; six live analyses on 2026-10-16 ended `AI_RATE_LIMITED` with no mock or paid fallback. Retry after the quota resets (or with a funded key) using the same release.
* **Backups:** installed and scheduled, restore of a live-database backup proven in isolation, but **no off-host copy** (disaster recovery incomplete) and the first scheduled run is not yet observed.
* **Host risks:** a daily host cron prunes unused Docker images older than 24 h (rollback images are protected by anchor containers, not by changing the cron); reboot and security updates pending; the deployed tree is not a git checkout.
* **Deferred defects:** duplicate tickets on concurrent identical submissions; admin search covers the current page only; liveness-only health check; internal-note/assignment deletion not trigger-protected (needs a migration).
* **Not implemented:** password reset, e-mail notifications, attachment deletion, server-side search.
* **Registration:** reveals whether an address is registered (no e-mail verification); self-registered authors start with no books and there is no screen to link books yet; registration throttling is per process.
* **Release state:** self-registration, the original sample dataset (10 authors, 18 books) and the AI accuracy release are deployed. The older synthetic accounts and ~170 synthetic test tickets remain in the database; their removal is planned (`docs/release/SYNTHETIC_CLEANUP_PLAN_V2.md`) but not executed.
* **Model quality limits:** a draft can reuse a policy time frame that belongs to a different step of the same topic (for example the 5-7 day reprint turnaround used for a photo-review reply). The admin review step is the control for this.
* Login throttling and AI single-flight are per process (single API instance).
* Rule-based fallback labelling lives in the rationale text because persisting a quality field needs a migration.

Full detail: `docs/KNOWN_LIMITATIONS.md`, `docs/architecture/17-KNOWN-LIMITATIONS.md`.
