# Federation — managing multiple PVE clusters from one Nexus

As of **v0.34.0**, Nexus can connect to remote PVE clusters alongside the local one. The registry is encrypted at rest, credentials use PVE API tokens (not passwords), and a background probe reports reachability + quorum on a 60-second loop.

## What v0.34.0 lands (and what's still coming)

| Feature | v0.34.0 | Later release |
| --- | --- | --- |
| Encrypted cluster registry | ✅ | |
| Per-cluster health probe (reachability + quorum + latency) | ✅ | |
| `/dashboard/federation` — add / rotate / remove clusters | ✅ | |
| Raw API proxy to a registered cluster (`/api/proxmox/[...path]?cluster=<id>`) | ✅ | |
| Password-based auth with background ticket refresh | | v0.35+ (optional) |
| **Federated resource tree** — see remote cluster VMs/CTs in the sidebar | | §6.2 |
| **Cross-cluster console** — noVNC/xterm into a remote guest | | §6.3 |
| **Cross-cluster live migration** — `qm remote-migrate` wrapper | | §6.4 |
| **Nexus HA pair** — two-LXC failover recipe | | §6.5 |

Short version: v0.34.0 lands the **plumbing** — registry, probes, authenticated proxy. The UI surfaces that plumbing via `/dashboard/federation` but doesn't yet aggregate remote cluster data into the main resource tree. That comes in §6.2.

## Adding a remote cluster

1. **Create a PVE API token in the remote cluster.** In that cluster's PVE UI, go to *Datacenter → Permissions → API Tokens*. Create a token on a service user (not `root@pam` — use a dedicated `nexus@pve` or similar). Note the token ID (format: `user@realm!tokenname`) and the secret UUID that PVE displays **once** on creation.

2. **Grant the token privileges in the remote cluster.** At minimum give it `PVEAuditor` on `/` for read-only federation. Add `PVEAdmin` on the paths it needs to manage if you plan to mutate from Nexus.

3. **In Nexus, go to `/dashboard/federation`** and click **Add cluster**.

4. **Step 1 — Identity.** Enter a display name (e.g. "Production East") and a slug id. The id must match `[a-z][a-z0-9-]{0,31}` (lowercase letters and digits, hyphens allowed, must start with a letter). This id appears in the proxy URL (`?cluster=<id>`). The reserved id `local` cannot be used.

5. **Step 2 — Endpoints.** Add 1–4 `https://` endpoint URLs for the cluster. The probe walks them in order and sticks to the most-recently-successful one for subsequent requests, so list your preferred entry point first.

6. **Step 3 — API token.** Paste the token ID + secret from step 1. Nexus never sees the remote cluster's PVE user password.

7. **Step 4 — Confirm.** Review the summary. On save, the cluster is encrypted to disk (`federation.json`) and the in-memory resolver is reloaded. The first probe fires immediately, so the row turns green within seconds if the cluster is reachable.

## Rotating credentials

Open the kebab menu on any row and pick **Rotate credentials**. Enter a new tokenId + tokenSecret; the old ones are immediately replaced (no dual-validity window). The rotated-at timestamp updates on the row.

The old API token in PVE is not automatically deleted — you do that in the remote cluster's UI after confirming Nexus is happy with the new one.

## Removing a cluster

Kebab menu → **Remove**. You'll be asked to type the cluster's display name as a confirmation phrase. On delete, the row disappears immediately and future `?cluster=<id>` requests for that id return 404. In-flight requests against the removed cluster complete normally against their captured-at-request-start credentials.

## Understanding probe status

| Dot | Meaning |
| --- | --- |
| 🟢 Green — "Healthy" | Probe reached a listed endpoint and Corosync reports the cluster as quorate. |
| 🟡 Amber — "No quorum" or "Quorum unknown" | Endpoint is reachable, but the cluster has lost quorum (storage/HA operations will be read-only) or the status fetch itself failed. |
| 🔴 Red — "Unreachable" | Every listed endpoint failed on the last probe. Hover the row to see the `lastError`. |
| ⚪ Grey — "Probing…" | First probe hasn't completed yet. This window is normally seconds; if it lasts longer, check `journalctl -u nexus` for `event=federation_probe_tick_failed`. |

## Troubleshooting

**Row is red with "connect ECONNREFUSED".** The endpoint is wrong (typo in URL, wrong port) or the remote PVE host is down. Test from the Nexus LXC with `curl -k https://<endpoint>/api2/json/version`.

**Row is red with "unable to verify the first certificate".** Should not happen — Nexus uses the same scoped-TLS-bypass `undici` Agent for federation as it does for the local cluster. If you see this, open an issue.

**Row is red with "401 Unauthorized" or similar.** The token's secret is wrong, the token was revoked in the remote PVE UI, or the token user lacks the `PVEAuditor` privilege. Rotate credentials to fix.

**Row is amber with "No quorum".** The remote cluster itself has lost Corosync quorum (a node went down and majority is lost). Nexus can still read but PVE will refuse mutating operations until quorum returns. This is a state in the remote cluster, not a Nexus bug.

**I called `/api/proxmox/<path>?cluster=<id>` and got 403 "Resource not proxied".** The top-level allowlist from v0.33.0 applies to federated traffic too. Only `cluster`, `nodes`, `storage`, `access`, `pools`, `version` resource families are forwarded. See `Configuration.md` → Security headers for the rationale.

**Added a cluster and immediately called the proxy, got 404 "Cluster not registered".** Tiny boot race — the in-memory resolver hasn't reloaded yet. Retry after ~100ms. The `/api/federation/clusters` POST handler calls `reloadFederation()` synchronously, so this should be rare.

## File footprint

- **Registry:** `${NEXUS_DATA_DIR}/federation.json`. AES-256-GCM envelope, key derived from `JWT_SECRET`. Mode `0600`. Atomic writes via tmp+rename.
- **Probe state:** in-memory only, rebuilt on boot (~60s window where all rows show "Probing…").
- **Logs:** structured events `[nexus event=federation_probe_tick_failed]` and `[nexus event=federation_probe_initial_failed]` go to stderr.

Rotating `JWT_SECRET` invalidates the registry (you'll see an empty list after restart). Re-add your clusters from the UI in that case.
