# 17. Known Limitations

This is the architecture-level summary. The reviewer-facing list is [docs/KNOWN_LIMITATIONS.md](../KNOWN_LIMITATIONS.md), and
every numbered defect lives in [docs/qa/BUG_REGISTER.md](../qa/BUG_REGISTER.md).

## 17.1 By design

| Limitation | Consequence |
| --- | --- |
| Single API instance | Login throttling, per-author rate limits, SSE streams and AI single-flight are in memory and reset on restart; they are not shared across instances |
| Same-site deployment | The API does not serve the web app; one origin (reverse proxy) is required so the `SameSite=Lax` cookie is first-party |
| Attachments on local disk | Must be backed up with the database; no antivirus scanning; PDF, PNG, JPEG, WebP, plain text; 5 MiB; 5 per ticket |
| No e-mail delivery | Admin replies appear in the portal and over SSE only |
| AI is advisory | A human reviews and sends every draft; an unavailable provider records a `FAILED` attempt and tickets continue manually |
| Missing `Origin` header accepted on mutating requests | Non-browser clients are allowed; the CSRF token is still required |
| Admin search is client-side | The queue search box filters only the 25 tickets of the current page (the API rejects a `q` parameter) |
| Admin queue order | Unresolved tickets sort by priority (unprioritised last) then oldest first, so a brand-new unclassified ticket sits behind older prioritised ones |

## 17.2 Not done / not verified

| Area | Status |
| --- | --- |
| Real OpenRouter inference | Never exercised. Output quality, latency and cost are unknown |
| Staging demo AI | Canned, keyword-matched text labelled `[DEMO MOCK]` / `[DEMO DRAFT]`; it proves the pipeline and review flow only |
| TLS renewal | Certificate valid to 2027-01-13; renewal by Traefik was not observed |
| Backups | Encrypted daily cron installed 2026-10-16 (first scheduled run not yet observed); no off-host copy, same disk as the data |
| Multi-instance behaviour, load, soak, accessibility audit | Not tested |
| Browsers | Chromium and Microsoft Edge only |
| CI | None; test suites are run by hand |
| `DELETE` on history tables | `InternalNote` and `TicketAssignment` triggers cover `INSERT`/`UPDATE`, not `DELETE` (BUG-003) |

## 17.3 Environment risks outside the application

* The host has a pending reboot and 23 security-related package upgrades, and runs other tenants' containers on 1 vCPU / 3.9 GiB.
* BookLeaf shares Traefik with other tenants; an outage or configuration change there affects BookLeaf's HTTPS entry.
* Another tenant (Aadya) was removed from the host during the audit; the cause is unknown.

## 17.4 Registration and data hygiene

* Registration cannot hide that an address is already registered without e-mail verification (not implemented); mitigations are the generic `409`, equalised timing and per-IP/global limits.
* Self-registered authors have no books until someone links them (no admin UI or API yet) and carry empty phone/city values (`WEB-<hex>` external id).
* The audit log is append-only at the database level, so a cleanup of synthetic data cannot remove the audit rows that describe it; they stay as evidence.
* The cleanup tool is exercised by automated tests and a local container rehearsal in the real API image; it has not been run against production.
