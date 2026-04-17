#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexus — Proxmox Management UI  |  Install Script
#
# Downloads the latest prebuilt release from GitHub and installs it with:
#   /opt/nexus/releases/<tag>/     — immutable release artifacts
#   /opt/nexus/current -> ...      — symlink flipped by updater
#   /opt/nexus/.env.local          — persisted across upgrades
#   /usr/local/bin/nexus-update    — in-place updater used by UI + CLI
#
# Run on the Proxmox host as root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/Actualbug2005/Proxmox/main/install.sh)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[nexus]${NC} $*"; }
success() { echo -e "${GREEN}[nexus]${NC} $*"; }
warn()    { echo -e "${YELLOW}[nexus]${NC} $*"; }
die()     { echo -e "${RED}[nexus] ERROR:${NC} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Please run as root (sudo or directly as root)"

# ── Config (env-overridable) ──────────────────────────────────────────────────
REPO="${NEXUS_REPO:-Actualbug2005/Proxmox}"
NEXUS_ROOT="${NEXUS_ROOT:-/opt/nexus}"
RELEASES_DIR="${NEXUS_ROOT}/releases"
CURRENT_LINK="${NEXUS_ROOT}/current"
SERVICE_NAME="${NEXUS_SERVICE:-nexus}"
PORT="${NEXUS_PORT:-3000}"
NODE_VERSION="22"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/main"

# ── Node.js ───────────────────────────────────────────────────────────────────
install_node() {
  if command -v node &>/dev/null; then
    local ver
    ver=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
    if [[ "$ver" -ge 22 ]]; then
      info "Node.js $ver already installed — skipping"
      return
    fi
    warn "Node.js $ver is too old (need ≥22 for --experimental-strip-types). Upgrading…"
  fi
  info "Installing Node.js ${NODE_VERSION} LTS via NodeSource…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y nodejs
  success "Node.js $(node -v) installed"
}

install_deps() {
  info "Installing OS deps (curl, python3, jq fallbacks)…"
  apt-get update -qq
  apt-get install -y curl ca-certificates python3 tar
}

# ── Fetch + install latest release ───────────────────────────────────────────
# Keeps this script self-contained for the fresh-install path. Subsequent
# updates go through /usr/local/bin/nexus-update (same logic, versioned).
install_release() {
  mkdir -p "$RELEASES_DIR"

  info "Querying latest release from GitHub"
  local json
  json=$(curl -fsSL --proto '=https' --proto-redir '=https' \
              -H 'Accept: application/vnd.github+json' \
              -H 'X-GitHub-Api-Version: 2022-11-28' \
              "https://api.github.com/repos/${REPO}/releases/latest") \
    || die "Could not reach GitHub API. Check connectivity or rate-limit status."

  # Parse with python3 to avoid jq dependency.
  local tag tar_url sha_url
  read -r tag tar_url sha_url < <(
    echo "$json" | python3 -c '
import sys, json
d = json.load(sys.stdin)
tag = d.get("tag_name", "")
assets = {a["name"]: a["browser_download_url"] for a in d.get("assets", [])}
tar = next((u for n, u in assets.items() if n.endswith(".tar.gz")), "")
sha = next((u for n, u in assets.items() if n.endswith(".tar.gz.sha256")), "")
print(tag); print(tar); print(sha)
'
  )
  [[ -z "$tag"     ]] && die "Could not parse release tag"
  [[ -z "$tar_url" ]] && die "Latest release has no tarball asset yet. Wait for CI to finish."

  info "Installing release: $tag"
  local staging
  staging=$(mktemp -d "${RELEASES_DIR}/.staging.XXXXXX")
  trap 'rm -rf "$staging"' RETURN

  info "Downloading tarball"
  curl -fsSL --proto '=https' --proto-redir '=https' \
       -o "${staging}/release.tar.gz" "$tar_url"

  if [[ -n "$sha_url" ]]; then
    info "Verifying SHA256"
    curl -fsSL --proto '=https' --proto-redir '=https' \
         -o "${staging}/release.tar.gz.sha256" "$sha_url"
    local expected actual
    expected=$(awk '{print $1}' "${staging}/release.tar.gz.sha256")
    actual=$(sha256sum "${staging}/release.tar.gz" | awk '{print $1}')
    [[ "$expected" == "$actual" ]] || die "Checksum mismatch: expected $expected, got $actual"
    success "Checksum OK"
  else
    warn "Release published no checksum file — skipping verification"
  fi

  local target="${RELEASES_DIR}/${tag}"
  if [[ -d "$target" ]]; then
    warn "Release dir exists, replacing: $target"
    rm -rf "$target"
  fi
  mkdir -p "$target"
  tar -xzf "${staging}/release.tar.gz" -C "$target"
  ln -sfn "$target" "$CURRENT_LINK"
  success "Release extracted, /opt/nexus/current → $tag"
}

# ── Installed updater helper ──────────────────────────────────────────────────
install_updater() {
  info "Installing nexus-update helper at /usr/local/bin/nexus-update"
  curl -fsSL --proto '=https' --proto-redir '=https' \
       -o /usr/local/bin/nexus-update \
       "${RAW_BASE}/bin/nexus-update.sh"
  chmod +x /usr/local/bin/nexus-update
  success "nexus-update installed"
}

# ── .env.local (persists across upgrades) ─────────────────────────────────────
write_env() {
  local env_file="${NEXUS_ROOT}/.env.local"

  if [[ -f "$env_file" ]]; then
    info ".env.local already exists at $env_file — preserving"
    return
  fi

  local jwt_secret
  jwt_secret=$(openssl rand -base64 36 | tr -d '\n')

  cat > "$env_file" <<EOF
# ─── Nexus runtime config ───────────────────────────────────────────────────
# Lives at /opt/nexus/.env.local and survives release upgrades — each release
# dir symlinks or reads it from here rather than carrying its own copy.

# Proxmox host — localhost because Nexus runs on the PVE host directly.
PROXMOX_HOST=localhost

# JWT session secret — auto-generated, never share, never commit.
JWT_SECRET=${jwt_secret}

# Port (must match systemd + firewall rule).
PORT=${PORT}

# Production mode: Secure cookies require NODE_ENV=production.
NODE_ENV=production

# Loopback-only bind: nothing on the LAN can bypass your reverse proxy
# or tunnel. Set to 0.0.0.0 only for local dev.
HOSTNAME=127.0.0.1

# ── Session store (optional) ─────────────────────────────────────────────────
# Single-node default: sessions live in an in-memory Map (lost on restart).
# For HA / multi-instance, uncomment:
# REDIS_URL=redis://127.0.0.1:6379
EOF
  # Also expose the env file at current/.env.local as a symlink so Next.js
  # picks it up without any systemd wiring trickery.
  ln -sfn "$env_file" "${CURRENT_LINK}/.env.local"
  success ".env.local written ($env_file) and linked into current/"
}

# ── systemd service ───────────────────────────────────────────────────────────
install_service() {
  local node_bin
  node_bin=$(command -v node)
  [[ -n "$node_bin" && -x "$node_bin" ]] || die "Cannot locate node binary"
  node_bin=$(readlink -f "$node_bin")
  local node_dir
  node_dir=$(dirname "$node_bin")

  # `--experimental-strip-types` lets Node run server.ts directly without a
  # TypeScript compile step. server.ts only uses declaration-style annotations
  # (no TS-only runtime features) so strip-types is sufficient.
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Nexus — Proxmox Management UI
After=network.target pve-cluster.service
Wants=pve-cluster.service

[Service]
Type=simple
WorkingDirectory=${CURRENT_LINK}
ExecStart=${node_bin} --experimental-strip-types ${CURRENT_LINK}/server.ts
Restart=always
RestartSec=2
Environment=PATH=${node_dir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=${NEXUS_ROOT}/.env.local
User=root

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
  success "Systemd service '${SERVICE_NAME}' installed and started"
}

# ── Firewall ─────────────────────────────────────────────────────────────────
open_firewall() {
  if command -v pvesh &>/dev/null; then
    local existing
    existing=$(pvesh get "/nodes/$(hostname)/firewall/rules" 2>/dev/null | grep -c "${PORT}" || true)
    if [[ "$existing" -eq 0 ]]; then
      info "Opening port ${PORT} in PVE host firewall…"
      pvesh create "/nodes/$(hostname)/firewall/rules" \
        --action ACCEPT --type in --proto tcp --dport "${PORT}" --enable 1 2>/dev/null \
        && success "Firewall rule added for port ${PORT}" \
        || warn "Could not add firewall rule — open port ${PORT} manually if needed"
    else
      info "Firewall rule for port ${PORT} already exists"
    fi
  fi
}

summary() {
  local ver="unknown"
  [[ -r "${CURRENT_LINK}/VERSION" ]] && ver=$(cat "${CURRENT_LINK}/VERSION")
  echo ""
  echo -e "  ${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  ${GREEN}  Nexus ${ver} running on http://$(hostname -I | awk '{print $1}'):${PORT}${NC}"
  echo -e "  ${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  Next steps:"
  echo -e "    • Harden the install: ${CYAN}bash <(curl -fsSL ${RAW_BASE}/deploy/install-hardening.sh)${NC}"
  echo -e "    • Check for updates:  ${CYAN}nexus-update --check${NC}"
  echo -e "    • Install update:     ${CYAN}nexus-update${NC}  (or use the UI → System → Updates)"
  echo -e "    • Logs:               ${CYAN}journalctl -u ${SERVICE_NAME} -f${NC}"
  echo ""
}

main() {
  echo ""
  echo -e "  ${CYAN}╔══════════════════════════════════════╗${NC}"
  echo -e "  ${CYAN}║   Nexus — Proxmox Management UI      ║${NC}"
  echo -e "  ${CYAN}╚══════════════════════════════════════╝${NC}"
  echo ""
  install_deps
  install_node
  install_release
  install_updater
  write_env
  install_service
  open_firewall
  summary
}

main "$@"
