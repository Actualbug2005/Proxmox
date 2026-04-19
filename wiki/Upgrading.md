# Upgrading

Nexus releases follow SemVer and ship as prebuilt tarballs attached to GitHub Releases. The installer supports side-by-side release directories and an atomic symlink flip, so upgrades are fast and roll back cleanly.

## Release model

- **Versioning:** `MAJOR.MINOR.PATCH` (SemVer).
- **Release tarball:** one `nexus-vX.Y.Z.tar.gz` per release, attached to the GitHub Release at <https://github.com/Actualbug2005/Proxmox/releases>.
- **Version file:** every tarball bakes `VERSION` containing the SemVer string. Nexus reads it at startup and exposes it on `/api/health` and in the UI.
- **Layout on disk:**

  ```
  /opt/nexus/
    releases/
      v0.27.3/          # previous
      v0.28.0/          # previous
      v0.28.1/          # current
    current -> releases/v0.28.1
    .env.local          # persists across upgrades
  ```

## In-place upgrade

The installer drops a `/usr/local/bin/nexus-update` helper for this. Run:

```bash
nexus-update
```

It:

1. Fetches the latest release tarball.
2. Unpacks into `/opt/nexus/releases/<new-tag>/`.
3. Flips the `current` symlink.
4. Restarts the `nexus` systemd unit.

Downtime is sub-second (the time it takes systemd to swap processes). The UI shows a toast when the new version is running and prompts a reload.

## Upgrade via installer re-run

The one-liner installer is also idempotent — running it again fetches the latest release on top of your existing install. Use this if `nexus-update` has been removed or if you want to force a fresh `.env.local` merge.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Actualbug2005/Proxmox/main/install.sh)
```

Your `.env.local` is never overwritten — new defaults are appended as comments only if the schema has grown.

## Rollback

Because previous release directories stay on disk:

```bash
ln -sfn /opt/nexus/releases/v0.27.3 /opt/nexus/current
systemctl restart nexus
```

Done. If the rollback target is before a breaking schema change (see **Breaking changes** below), read that release's notes before flipping.

## What persists across upgrades

| Persists | Resets |
| --- | --- |
| `.env.local` (all env vars) | In-memory sessions (unless `REDIS_URL` is set) |
| Everything under `$NEXUS_DATA_DIR` (scheduled jobs, scheduled chains) | Job run history for single scripts (chain history persists) |
| Redis session store | |

## Breaking changes policy

Major-version bumps (`0.x → 1.x`, `1.x → 2.x`) may introduce breaking changes. Minor and patch bumps **do not** change:

- Persisted file formats (jobs, chains).
- Env var names or semantics.
- Systemd unit file path or service name.

Release notes flag any breaking change with a `⚠️ BREAKING:` prefix and a migration note.

## Changelog

- **GitHub Releases:** <https://github.com/Actualbug2005/Proxmox/releases>
- Each release page shows the full git log since the previous tag, plus any highlighted changes.

## Health check

After any upgrade:

```bash
curl -s http://localhost:3000/api/health | jq
```

You should see `{"status":"ok","version":"<new-tag>","uptime":...}`.
