# Community Scripts

Nexus embeds the full [community-scripts.org](https://community-scripts.org) marketplace (formerly tteck's scripts) with an execution UI tailored for long-running installs.

![Community Scripts catalogue two-pane view](images/scripts-catalogue.png)

## What's in the catalogue

Every script the upstream PocketBase API exposes — LXC templates, VM installers, ad-hoc utility scripts. Metadata (logo, description, default credentials, severity notes, install-method variants) comes from the upstream API, not a local snapshot, so additions show up the next time you refresh.

## Browsing

Two-pane layout: **left** is the scrollable/searchable list with category filters; **right** is the per-script detail pane.

## Per-script detail

![Per-script detail pane with install-method tabs, env overrides, credentials, and severity notes](images/scripts-detail.png)

For each script the detail pane shows:

- **Install-method tabs** — one tab per variant upstream publishes (e.g. "default" vs "advanced").
- **Env overrides** — best-effort form over the script's documented environment variables: hostname, CT ID, CPU/RAM/disk, storage, password. Leave blank for upstream defaults.
- **Credentials** — any default login surface the script ships with (rendered in a copy-to-clipboard block).
- **Severity-coloured notes** — any "requires manual step" or "destructive action" warnings upstream ships.

## Fire-and-forget execution

Most Community Scripts take minutes to run (LXC creation, downloads, builds). Cloudflare Tunnel drops any single HTTP request after 100 seconds, which would kill a foreground run.

Nexus **never blocks the HTTP request on the script finishing.** When you click **Run**:

1. The server spawns the script detached.
2. The API returns a `jobId` immediately (usually under 500 ms).
3. A **floating bottom-right status bar** appears showing the job's state.

![Floating status bar and live-log drawer while a script is running](images/scripts-running.png)

The status bar has two controls:

- **Open log** — slides out a drawer with the live stdout/stderr stream. You can close it and reopen it any time.
- **Abort** — sends SIGTERM, then SIGKILL after a grace period. The job transitions to `failure`.

When the job finishes, the status bar fades out after a few seconds. Completed jobs remain visible in the job list until the page is refreshed.

## Troubleshooting

### "Why did my script run in the wrong storage?"

The env-override form is **best-effort**: it fills in the upstream script's documented env var names, but some variants of the script read storage from a different var name or ignore the env entirely. Check the script's docs on community-scripts.org for the exact knobs, and use the "raw env" section at the bottom of the form to pass anything the UI doesn't know about.

### "How do I see past runs?"

Job state is in-memory on the server — a restart clears the list. Persistent history is tracked for **[Script Chains](Script-Chains)** only; use a chain (even with a single step) if you need a run log that survives restarts.

### "The script hangs forever"

Scripts that prompt on stdin will hang because Nexus spawns them non-interactive. Check the upstream script for a `NONINTERACTIVE=1` env flag (many have one) and set it in the env-override form.
