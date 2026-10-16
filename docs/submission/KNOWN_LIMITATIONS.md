# Known limitations

* **Real AI verified with limits.** On the default free model, classification was 6/6 correct and drafts passed the grounding check in 12 of 13 analyses after prompt hardening (3/6 before); the sample is small and non-deterministic, so expect an occasional labelled rule-based fallback. The Gemma alternative was rate limited upstream. Free models may log prompts and are rate limited (20/min, 50/day documented without credits). The validator cannot judge semantic quality; human review is required (and enforced).
* **The 48-hour wording** in the knowledge-base tone guideline and royalty example is unverified as a company commitment. The AI is told not to repeat it; add it to a policy chunk if it is real.
* **Staging runs the demo mock**; its output is canned text, not inference.
* **Backups are not operational:** scripts tested locally only; nothing scheduled; no off-host copy; no restore from production data.
* **Host risks:** a daily cron prunes unused Docker images older than 24 h (can delete rollback images); reboot and security updates pending; the deployed tree is not a git checkout.
* **Deferred defects:** duplicate tickets on concurrent identical submissions; admin search covers the current page only; liveness-only health check; internal-note/assignment deletion not trigger-protected (needs a migration).
* **Not implemented:** password reset, e-mail notifications, attachment deletion, server-side search.
* Login throttling and AI single-flight are per process (single API instance).
* Rule-based fallback labelling lives in the rationale text because persisting a quality field needs a migration.

Full detail: `docs/KNOWN_LIMITATIONS.md`, `docs/architecture/17-KNOWN-LIMITATIONS.md`.
