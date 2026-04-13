#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexus — Proxmox Management UI  |  Install Script
# Run directly on the Proxmox host as root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/<your-repo>/main/install.sh)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[nexus]${NC} $*"; }
success() { echo -e "${GREEN}[nexus]${NC} $*"; }
warn()    { echo -e "${YELLOW}[nexus]${NC} $*"; }
die()     { echo -e "${RED}[nexus] ERROR:${NC} $*" >&2; exit 1; }

# ── Require root ──────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Please run as root (sudo or directly as root)"

INSTALL_DIR="/opt/nexus"
SERVICE_NAME="nexus"
PORT="${NEXUS_PORT:-3000}"
REPO_URL="https://github.com/Actualbug2005/Proxmox.git"
REPO_BRANCH="main"
NODE_VERSION="22"   # LTS

# Allow caller to override repo URL
REPO_URL="${NEXUS_REPO_URL:-$REPO_URL}"

# ── Node.js ───────────────────────────────────────────────────────────────────
install_node() {
  if command -v node &>/dev/null; then
    local ver
    ver=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
    if [[ "$ver" -ge 20 ]]; then
      info "Node.js $ver already installed — skipping"
      return
    fi
    warn "Node.js $ver is too old (need ≥20). Upgrading…"
  fi

  info "Installing Node.js ${NODE_VERSION} LTS via NodeSource…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y nodejs
  success "Node.js $(node -v) installed"
}

# ── Git ───────────────────────────────────────────────────────────────────────
install_git() {
  if ! command -v git &>/dev/null; then
    info "Installing git…"
    apt-get install -y git
  fi
}

# ── Clone or update ───────────────────────────────────────────────────────────
clone_or_update() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Updating existing installation at $INSTALL_DIR…"
    git -C "$INSTALL_DIR" fetch --depth=1 origin "$REPO_BRANCH"
    git -C "$INSTALL_DIR" reset --hard "origin/$REPO_BRANCH"
  else
    info "Cloning repo into $INSTALL_DIR…"
    git clone --depth=1 --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

# ── Build ─────────────────────────────────────────────────────────────────────
build_app() {
  local app_dir="$INSTALL_DIR/nexus"
  [[ -d "$app_dir" ]] || die "nexus/ directory not found inside $INSTALL_DIR"

  info "Installing npm dependencies (including devDependencies for build)…"
  npm --prefix "$app_dir" install 2>&1 | tail -3

  info "Building Next.js app…"
  npm --prefix "$app_dir" run build 2>&1 | tail -15

  info "Pruning devDependencies after build…"
  npm --prefix "$app_dir" prune --omit=dev 2>&1 | tail -3

  success "Build complete"
}

# ── .env.local ────────────────────────────────────────────────────────────────
write_env() {
  local env_file="$INSTALL_DIR/nexus/.env.local"

  if [[ -f "$env_file" ]]; then
    info ".env.local already exists — skipping (edit manually if needed)"
    return
  fi

  # Generate a random JWT secret
  local jwt_secret
  jwt_secret=$(openssl rand -base64 36 | tr -d '\n')

  cat > "$env_file" <<EOF
# Proxmox host — localhost because Nexus runs on the PVE host directly
PROXMOX_HOST=localhost

# JWT session secret — auto-generated, do not share
JWT_SECRET=${jwt_secret}

# Required for PVE self-signed certificates
NODE_TLS_REJECT_UNAUTHORIZED=0

# Port (must match systemd service below)
PORT=${PORT}
EOF

  success ".env.local written to $env_file"
}

# ── systemd service ───────────────────────────────────────────────────────────
install_service() {
  # Find the real node binary — nvm installs a shell script shim, not a real binary.
  # We need the actual versioned binary path for systemd (which has no shell env).
  local node_bin

  # 1. Check nvm's current version directory directly
  if [[ -d "$HOME/.nvm/versions/node" ]]; then
    node_bin=$(find "$HOME/.nvm/versions/node" -name "node" -type f 2>/dev/null | sort -V | tail -1)
  fi

  # 2. Fall back to which/command -v (works for nodesource / system installs)
  if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
    node_bin=$(command -v node 2>/dev/null || true)
    # Resolve symlinks (nodesource puts a symlink at /usr/bin/node)
    [[ -n "$node_bin" ]] && node_bin=$(readlink -f "$node_bin")
  fi

  [[ -z "$node_bin" || ! -x "$node_bin" ]] && die "Cannot locate node binary"

  local node_dir
  node_dir=$(dirname "$node_bin")

  # Use node + local next binary directly — avoids npm/npx shim issues under systemd
  local exec_start="${node_bin} ${INSTALL_DIR}/nexus/node_modules/.bin/next start --port ${PORT}"

  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Nexus — Proxmox Management UI
After=network.target pve-cluster.service
Wants=pve-cluster.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}/nexus
ExecStart=${exec_start}
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PATH=${node_dir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=${INSTALL_DIR}/nexus/.env.local
User=root

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"

  success "Systemd service '${SERVICE_NAME}' installed and started"
}

# ── Firewall ──────────────────────────────────────────────────────────────────
open_firewall() {
  if command -v pvesh &>/dev/null; then
    # Check if a rule for this port already exists
    local existing
    existing=$(pvesh get "/nodes/$(hostname)/firewall/rules" 2>/dev/null | grep -c "${PORT}" || true)
    if [[ "$existing" -eq 0 ]]; then
      info "Opening port ${PORT} in PVE host firewall…"
      pvesh create "/nodes/$(hostname)/firewall/rules" \
        --action ACCEPT --type in --proto tcp --dport "${PORT}" --enable 1 2>/dev/null && \
        success "Firewall rule added for port ${PORT}" || \
        warn "Could not add firewall rule — open port ${PORT} manually if needed"
    else
      info "Firewall rule for port ${PORT} already exists"
    fi
  fi
}

# ── Firewall hint ─────────────────────────────────────────────────────────────
firewall_hint() {
  if command -v pvesh &>/dev/null; then
    # We're on a PVE host — check if port is open
    if ! ss -tlnp | grep -q ":${PORT} "; then
      warn "Port ${PORT} does not appear to be listening yet — service may still be starting"
    fi
  fi

  echo ""
  echo -e "  ${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  ${GREEN}  Nexus is running on http://$(hostname -I | awk '{print $1}'):${PORT}${NC}"
  echo -e "  ${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  Manage the service:"
  echo -e "    ${CYAN}systemctl status ${SERVICE_NAME}${NC}"
  echo -e "    ${CYAN}systemctl restart ${SERVICE_NAME}${NC}"
  echo -e "    ${CYAN}journalctl -u ${SERVICE_NAME} -f${NC}"
  echo ""
  echo -e "  To update Nexus later, re-run this script."
  echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "  ${CYAN}╔══════════════════════════════════════╗${NC}"
  echo -e "  ${CYAN}║   Nexus — Proxmox Management UI      ║${NC}"
  echo -e "  ${CYAN}╚══════════════════════════════════════╝${NC}"
  echo ""

  info "Updating apt cache…"
  apt-get update -qq

  install_git
  install_node
  clone_or_update
  write_env
  build_app
  install_service
  open_firewall
  firewall_hint
}

main "$@"
