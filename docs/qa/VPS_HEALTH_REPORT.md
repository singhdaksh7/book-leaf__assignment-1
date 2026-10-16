# VPS health report

Read-only inspection of `root@77.37.45.177` on 2026-10-15/16. BookLeaf was recreated or restarted only during the explicitly approved
recovery tests of the previous round; during this round the only live writes were ordinary synthetic ticket flows and one additive backup (previous round).

## 1. Host

| Item | Observed |
| --- | --- |
| OS / kernel | Ubuntu 24.04.5 LTS, 6.8.0-139-generic; up about 2 weeks 1 day |
| Capacity | 1 vCPU, 3.9 GiB RAM (about 2.3 GiB available), 2 GiB swap (421 MiB used), 48 GB disk 31% used, load average 0.7 |
| Docker | 29.8.1, Compose 5.5.1; 18 images (7.8 GB, 678 MB reclaimable), 14 volumes (458 MB) |
| Firewall | ufw active, default deny; 22, 80, 443 allowed (IPv4 and IPv6) |
| Listeners | `*:443`, `*:80` (Traefik), 22 (sshd), loopback-only helpers; nothing for BookLeaf |
| TLS | Let's Encrypt, `CN=bookleaf.77.37.45.177.sslip.io`, 2026-10-15 to 2027-01-13. Renewal not observed |
| Pending maintenance | **reboot required**; 23 security-related package upgrades available (not applied; owner decision) |
| Scheduled jobs | `cron.d`: `docker-builder-prune`, `docker-image-prune` (contents not inspected), `e2scrub_all`, `monarx-update`, `sysstat`. **Nothing schedules BookLeaf backups** |

## 2. BookLeaf stack

| Container | State | Image | Limits | Observed memory |
| --- | --- | --- | --- | --- |
| `bookleaf-db` | healthy, 0 restarts | `postgres:16-alpine` | 512 MiB | 31-35 MiB |
| `bookleaf-api` | healthy, 0 restarts | `bookleaf-api:localtest` (+ demo override) | 512 MiB | 122-154 MiB |
| `bookleaf-web` | healthy, 0 restarts | `bookleaf-web:loginfix-20261015` | 64 MiB | 2 MiB |

* Restart policy `unless-stopped` on all; log rotation json-file 10 MB x 3 (largest log 1.3 MB); no OOM kills in `dmesg`.
* Volumes: `bookleaf_bookleaf_pgdata` 47 MB, `bookleaf_bookleaf_attachments` 76 KB at the time of inspection; both named, persistent, not published.
* Configuration drift: every deployed infra file matched the repository (CRLF-normalised hashes) at the last release; the compiled API and web output matched a clean build of `3b09980`. The server holds only `infra/`, no source and no git checkout.
* `.env` is mode 600; `backups/` is mode 700 (6 files, all non-empty: dumps of 45,589 / 52,304 / 53,774 bytes; attachment archives of 185 / 506 / 627 bytes).
* Backup restore was proven in a disposable, network-isolated container (10 tables matched live row for row, UTF8, 6 triggers). The live database was never restored into.
* Database: 5 migrations applied, none rolled back; encoding UTF8; 17 foreign keys, 10 check constraints, 6 triggers, 25 secondary indexes; 0 orphan rows.

## 3. Neighbours

Currently running and healthy: Daxul (2), KP-CRM (3), Printout (4; the worker has no health check by design), Vastraa (3), Traefik (1) = **13 containers**, unchanged in health across BookLeaf's last deployment.

## 4. Incident: the Aadya tenant disappeared (separate from BookLeaf)

* **Observed.** At 10:34 UTC on 2026-10-15 `aadya-api`, `aadya-db` and `aadya-web` were running and healthy. By about 11:33 they were gone, together with their volumes, networks and `/opt/aadya`. No exited Aadya containers remain.
* **Evidence.** `last` shows a root SSH session from 10:56 lasting about 32 minutes (not one of the audit's short-lived sessions). Root shell history contains `rm -rf /opt/aadya`, `test ! -e /opt/aadya && echo "Aadya folder removed"` and then checks for leftover Aadya containers, volumes and networks. dockerd logged "stopping restart-manager" for several containers at 10:56. Earlier (before 10:34) a read-only `tar` container of the Aadya uploads volume ran, which looks like a backup.
* **Not established.** Who ran the session, whether it was authorised, and whether the Aadya data was preserved elsewhere. No Aadya resource was touched, restored or recreated by this audit.
* **Effect on BookLeaf.** None observed: BookLeaf containers, data and routing were unaffected and Traefik kept serving.
* **Needed.** Owner confirmation that the decommission was intentional, and if not, an incident response (credential review, session audit).

## 5. Findings

| ID | Severity | Item |
| --- | --- | --- |
| BUG-006 | MEDIUM | no backup schedule or off-host copy |
| BUG-014 | INFO | pending reboot, 23 security upgrades |
| BUG-015 | INFO | Aadya removal, cause unknown |
| BUG-008 | LOW | `/healthz` is liveness only |
| BUG-007 | LOW | image tags do not identify the commit |
| - | INFO | 1 vCPU shared with other tenants; Traefik is a shared single point of failure for HTTPS entry |
