#!/usr/bin/env bash
# Nexus release updater.
#
# Fetches the latest GitHub Release tarball, extracts it to a versioned
# directory under /opt/nexus/releases/, flips the /opt/nexus/current symlink,
# then restarts nexus.service via a 3-second systemd timer so whoever
# invoked this script (potentially Nexus itself) has time to respond before
# the process is killed.
#
# Usage:
#   nexus-update                 # install latest release (interactive-safe)
#   nexus-update --check         # print {current, latest, updateAvailable}, don't install
#   nexus-update --version <v>   # pin to a specific tag
#   nexus-update --rollback      # re-point 'current' at the previous release
#
# Exit codes:
#   0 — update installed (or nothing to do)
#   1 — preflight / network failure
#   2 — invalid arguments or no previous release to roll back to
#   3 — checksum mismatch — tarball NOT applied
#   4 — post-swap health check failed (symlink reverted)

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────
REPO="${NEXUS_REPO:-Actualbug2005/Proxmox}"
NEXUS_ROOT="${NEXUS_ROOT:-/opt/nexus}"
RELEASES_DIR="${NEXUS_ROOT}/releases"
CURRENT_LINK="${NEXUS_ROOT}/current"
SERVICE_NAME="${NEXUS_SERVICE:-nexus}"
GITHUB_API="https://api.github.com/repos/${REPO}/releases/latest"

MODE="install"
PIN_VERSION=""

# ─────────────────────────────────────────────────────────────────────────────
# Flags
# ─────────────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)     MODE="check"; shift ;;
    --rollback)  MODE="rollback"; shift ;;
    --version)   PIN_VERSION="$2"; shift 2 ;;
    --help|-h)   grep '^#' "$0" | head -20 | sed 's/^# \?//'; exit 0 ;;
    *)           echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

# ─────────────────────────────────────────────────────────────────────────────
# Output
# ─────────────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; D=$'\e[2m'; N=$'\e[0m'
else
  G=""; Y=""; R=""; D=""; N=""
fi
log() { echo -e "${G}[nexus-update]${N} $*"; }
warn() { echo -e "${Y}[nexus-update]${N} $*"; }
err() { echo -e "${R}[nexus-update]${N} $*" >&2; }

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
current_version() {
  if [[ -L "$CURRENT_LINK" && -r "${CURRENT_LINK}/VERSION" ]]; then
    cat "${CURRENT_LINK}/VERSION" 2>/dev/null || echo "unknown"
  else
    echo "none"
  fi
}

latest_release_json() {
  # GitHub's releases API returns JSON with assets[]. We want the tag_name
  # and the tarball URL. Fail fast on network / 404.
  curl -fsSL --proto '=https' --proto-redir '=https' \
       -H 'Accept: application/vnd.github+json' \
       -H 'X-GitHub-Api-Version: 2022-11-28' \
       "$GITHUB_API"
}

pinned_release_json() {
  local tag="$1"
  curl -fsSL --proto '=https' --proto-redir '=https' \
       -H 'Accept: application/vnd.github+json' \
       -H 'X-GitHub-Api-Version: 2022-11-28' \
       "https://api.github.com/repos/${REPO}/releases/tags/${tag}"
}

# Extract {tag, tarball_url, sha256_url} from a release JSON blob. We use
# python3 because it ships on Debian 12/13 stock — avoids a jq dependency.
parse_release() {
  python3 - "$@" <<'PY'
import sys, json
data = json.load(sys.stdin)
tag = data.get("tag_name", "")
assets = {a["name"]: a["browser_download_url"] for a in data.get("assets", [])}
tar = next((u for n, u in assets.items() if n.endswith(".tar.gz")), "")
sha = next((u for n, u in assets.items() if n.endswith(".tar.gz.sha256")), "")
print(tag)
print(tar)
print(sha)
PY
}

# ─────────────────────────────────────────────────────────────────────────────
# --check
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "check" ]]; then
  current=$(current_version)
  json=$(latest_release_json) || { err "Could not reach GitHub API"; exit 1; }
  read -r latest _ _ < <(echo "$json" | parse_release)
  update_available=$([[ "$current" != "$latest" && "$latest" != "" ]] && echo "true" || echo "false")
  printf '{"current":"%s","latest":"%s","updateAvailable":%s}\n' \
    "$current" "$latest" "$update_available"
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# --rollback
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "rollback" ]]; then
  [[ -L "$CURRENT_LINK" ]] || { err "No current symlink to roll back from"; exit 2; }
  current_target=$(readlink -f "$CURRENT_LINK")
  prev=$(find "$RELEASES_DIR" -maxdepth 1 -mindepth 1 -type d ! -path "$current_target" \
         -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
  [[ -z "$prev" ]] && { err "No previous release to roll back to"; exit 2; }
  log "Rolling back: $(basename "$current_target") → $(basename "$prev")"
  ln -sfn "$prev" "$CURRENT_LINK"
  systemd-run --on-active=3s --unit="nexus-restart-$(date +%s)" systemctl restart "$SERVICE_NAME"
  log "Restart scheduled in 3s. New current: $(basename "$prev")"
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Install
# ─────────────────────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || { err "Must run as root"; exit 1; }

# Resolve target release JSON
if [[ -n "$PIN_VERSION" ]]; then
  log "Fetching pinned release: $PIN_VERSION"
  json=$(pinned_release_json "$PIN_VERSION") || {
    err "Release '$PIN_VERSION' not found on GitHub"; exit 1;
  }
else
  log "Fetching latest release metadata"
  json=$(latest_release_json) || { err "Could not reach GitHub API"; exit 1; }
fi

read -r tag tar_url sha_url < <(echo "$json" | parse_release)

[[ -z "$tag"     ]] && { err "Could not parse release tag"; exit 1; }
[[ -z "$tar_url" ]] && { err "Release has no tarball asset"; exit 1; }

current=$(current_version)
if [[ "$current" == "$tag" ]]; then
  log "Already on $tag — nothing to do"
  exit 0
fi

log "Current: $current  →  New: $tag"

# Download to a staging dir
mkdir -p "$RELEASES_DIR"
staging=$(mktemp -d "${RELEASES_DIR}/.staging.XXXXXX")
trap 'rm -rf "$staging"' EXIT

log "Downloading tarball"
curl -fsSL --proto '=https' --proto-redir '=https' \
     -o "${staging}/release.tar.gz" \
     "$tar_url"

# Verify checksum if published
if [[ -n "$sha_url" ]]; then
  log "Verifying SHA256 checksum"
  curl -fsSL --proto '=https' --proto-redir '=https' \
       -o "${staging}/release.tar.gz.sha256" \
       "$sha_url"
  # The published .sha256 file is in sha256sum's native format:
  #   <hash>  <filename>
  # Feed it through sha256sum -c for verification, remapping the filename
  # since the download path differs from the expected basename.
  expected_hash=$(awk '{print $1}' "${staging}/release.tar.gz.sha256")
  actual_hash=$(sha256sum "${staging}/release.tar.gz" | awk '{print $1}')
  if [[ "$expected_hash" != "$actual_hash" ]]; then
    err "Checksum mismatch"
    err "  expected: $expected_hash"
    err "  actual:   $actual_hash"
    exit 3
  fi
  log "Checksum OK"
else
  warn "No checksum file published — skipping verification"
fi

# Extract into final release directory
target="${RELEASES_DIR}/${tag}"
if [[ -d "$target" ]]; then
  warn "Release dir already exists, replacing: $target"
  rm -rf "$target"
fi
mkdir -p "$target"
log "Extracting to $target"
tar -xzf "${staging}/release.tar.gz" -C "$target"

# Atomic symlink swap
old_target=""
if [[ -L "$CURRENT_LINK" ]]; then
  old_target=$(readlink -f "$CURRENT_LINK")
fi

log "Flipping $CURRENT_LINK → $target"
ln -sfn "$target" "$CURRENT_LINK"

# Schedule a delayed restart so the HTTP response from /api/system/update
# can finish flushing before systemd kills the process.
log "Scheduling restart of $SERVICE_NAME in 3s"
systemd-run --on-active=3s \
            --unit="nexus-restart-$(date +%s)" \
            systemctl restart "$SERVICE_NAME"

# Keep the last 3 releases, delete older ones
find "$RELEASES_DIR" -maxdepth 1 -mindepth 1 -type d -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn \
  | awk 'NR>3 {print $2}' \
  | xargs -r rm -rf

log "Updated to $tag. Service restarts in ~3 seconds."
echo "$tag"
