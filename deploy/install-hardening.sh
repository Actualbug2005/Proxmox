#!/usr/bin/env bash
# Nexus hardening installer — one-shot deploy of the Phase-2 L3 stack.
#
# What this does (idempotent — safe to re-run):
#   1. Installs CrowdSec if not present.
#   2. Deploys the Nexus login-event parser + three brute-force scenarios.
#   3. Auto-detects the primary LAN CIDR and allowlists it + loopback.
#   4. Wires CrowdSec to read Nexus's structured login logs from journalctl.
#   5. Installs the nftables firewall bouncer (auto-registers via apt postinst).
#   6. Installs Caddy and generates a self-signed TLS cert so the app speaks
#      HTTPS on :443 from first boot (auto-HTTPS-off + local_certs). Users
#      already behind Cloudflare/Tailscale can skip this step; it's
#      belt-and-braces for them.
#   7. Generates an RSA-4096 audit keypair at first run and reminds you,
#      loudly, to take the private half off this host.
#
# What this does NOT do:
#   - Configure a real cert (Let's Encrypt / Cloudflare origin cert). The
#     self-signed cert gets you HTTPS today; swap the `tls` directive in
#     /etc/caddy/Caddyfile later to upgrade.
#
# Usage:
#   ./install-hardening.sh            # interactive, prompts at each step
#   ./install-hardening.sh --yes      # non-interactive, assumes yes
#   ./install-hardening.sh --dry-run  # print what it would do, change nothing
#
# Exit codes:
#   0 — success
#   1 — preflight failed (not root, missing dep, etc)
#   2 — user aborted
#   3 — CrowdSec deploy failed
#   4 — firewall bouncer install failed

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Config — repo paths
# ──────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
PARSER_SRC="${SCRIPT_DIR}/crowdsec/parsers/s01-parse/nexus-login.yaml"
SCENARIO_SRC="${SCRIPT_DIR}/crowdsec/scenarios/nexus-bf.yaml"
ACQUIS_DST="/etc/crowdsec/acquis.d/nexus.yaml"
PARSER_DST="/etc/crowdsec/parsers/s01-parse/nexus-login.yaml"
SCENARIO_DST="/etc/crowdsec/scenarios/nexus-bf.yaml"
AUDIT_DIR="/etc/nexus"
AUDIT_PUBKEY="${AUDIT_DIR}/audit-pubkey.pem"
AUDIT_PRIVKEY_TMP="/root/audit-private.pem"
ALLOWLIST_NAME="nexus-homelab"

TLS_DIR="/etc/nexus/tls"
TLS_CERT="${TLS_DIR}/cert.pem"
TLS_KEY="${TLS_DIR}/key.pem"
CADDYFILE="/etc/caddy/Caddyfile"

# ──────────────────────────────────────────────────────────────────────────────
# Flags
# ──────────────────────────────────────────────────────────────────────────────
ASSUME_YES=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --dry-run|-n) DRY_RUN=1 ;;
    --help|-h)
      grep '^#' "$0" | head -40 | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# ──────────────────────────────────────────────────────────────────────────────
# Output helpers
# ──────────────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'
  BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step()  { echo -e "${BOLD}${BLUE}▶${RESET} ${BOLD}$*${RESET}"; }
ok()    { echo -e "  ${GREEN}✓${RESET} $*"; }
warn()  { echo -e "  ${YELLOW}⚠${RESET} $*"; }
fail()  { echo -e "  ${RED}✗${RESET} $*" >&2; }
info()  { echo -e "  ${DIM}$*${RESET}"; }

confirm() {
  local prompt="$1"
  if [[ $ASSUME_YES -eq 1 ]]; then
    info "[--yes] $prompt → yes"
    return 0
  fi
  read -r -p "  ${YELLOW}?${RESET} ${prompt} [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    info "[dry-run] $*"
  else
    eval "$@"
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Preflight
# ──────────────────────────────────────────────────────────────────────────────
step "Preflight checks"

if [[ $EUID -ne 0 ]]; then
  fail "Must run as root (or via sudo)."
  exit 1
fi
ok "Running as root"

if [[ ! -f "$PARSER_SRC" ]]; then
  fail "Parser source missing: $PARSER_SRC"
  info "Run this script from a Nexus checkout's deploy/ directory."
  exit 1
fi
ok "Repo layout looks correct (found $(basename "$PARSER_SRC"))"

if ! command -v systemctl &>/dev/null; then
  fail "systemctl not found — this script assumes a systemd host."
  exit 1
fi
ok "systemd available"

# ──────────────────────────────────────────────────────────────────────────────
# CrowdSec
# ──────────────────────────────────────────────────────────────────────────────
step "CrowdSec"

if command -v cscli &>/dev/null; then
  ok "CrowdSec already installed: $(cscli version | head -1 || echo '?')"
else
  warn "CrowdSec not found"
  if confirm "Install crowdsec via the official installer?"; then
    run "curl -s https://install.crowdsec.net | sh"
    run "apt-get install -y crowdsec"
    ok "CrowdSec installed"
  else
    fail "Cannot continue without CrowdSec."
    exit 2
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
# Parser + scenarios
# ──────────────────────────────────────────────────────────────────────────────
step "Deploy parser + scenarios"

run "install -D -m 0644 '$PARSER_SRC' '$PARSER_DST'"
ok "Parser → $PARSER_DST"

run "install -D -m 0644 '$SCENARIO_SRC' '$SCENARIO_DST'"
ok "Scenarios → $SCENARIO_DST"

# ──────────────────────────────────────────────────────────────────────────────
# Log acquisition
# ──────────────────────────────────────────────────────────────────────────────
step "Wire CrowdSec to read Nexus logs from journalctl"

run "mkdir -p /etc/crowdsec/acquis.d"

if [[ $DRY_RUN -eq 0 ]]; then
  cat > "$ACQUIS_DST" <<'EOF'
# Auto-generated by deploy/install-hardening.sh
source: journalctl
journalctl_filter:
  - _SYSTEMD_UNIT=nexus.service
labels:
  type: nexus
EOF
fi
ok "Acquisition config → $ACQUIS_DST"

# ──────────────────────────────────────────────────────────────────────────────
# Allowlist auto-detect
# ──────────────────────────────────────────────────────────────────────────────
step "Allowlist: detect primary LAN subnet"

# Pick the subnet of the interface holding the default route — that's almost
# always the admin's LAN. Fall back to all RFC1918 subnets directly attached.
default_iface=$(ip -4 route show default 2>/dev/null | awk '{print $5; exit}')
if [[ -n "$default_iface" ]]; then
  lan_cidr=$(ip -4 -o addr show dev "$default_iface" 2>/dev/null \
             | awk '{print $4; exit}')
  ok "Default interface: $default_iface"
  ok "Detected LAN CIDR: $lan_cidr"
else
  warn "Could not detect default interface; skipping auto-allowlist"
  lan_cidr=""
fi

if cscli allowlists inspect "$ALLOWLIST_NAME" &>/dev/null; then
  ok "Allowlist '$ALLOWLIST_NAME' already exists"
else
  run "cscli allowlists create '$ALLOWLIST_NAME' --description 'Nexus admin + LAN'"
  ok "Created allowlist '$ALLOWLIST_NAME'"
fi

add_allow() {
  local value="$1"
  # cscli exits non-zero if the value is already present — treat that as OK.
  if run "cscli allowlists add '$ALLOWLIST_NAME' '$value' 2>&1 | grep -vq 'already in allowlist'"; then
    ok "Allowlisted $value"
  else
    info "Already allowlisted: $value"
  fi
}

if [[ -n "$lan_cidr" ]]; then add_allow "$lan_cidr"; fi
add_allow "127.0.0.1"
add_allow "::1"

# ──────────────────────────────────────────────────────────────────────────────
# Firewall bouncer
# ──────────────────────────────────────────────────────────────────────────────
step "Firewall bouncer (L3/L4 drop)"

if dpkg -l crowdsec-firewall-bouncer-nftables 2>/dev/null | grep -q '^ii'; then
  ok "nftables bouncer already installed"
else
  if confirm "Install crowdsec-firewall-bouncer-nftables?"; then
    run "apt-get install -y crowdsec-firewall-bouncer-nftables" || {
      fail "Bouncer install failed"; exit 4;
    }
    ok "Bouncer installed (auto-registered via apt postinst)"
  else
    warn "Skipped bouncer install — decisions will be logged but not enforced"
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
# HTTPS (self-signed cert + Caddy reverse proxy)
# ──────────────────────────────────────────────────────────────────────────────
step "HTTPS — self-signed cert + Caddy on :443"

if confirm "Install Caddy + generate a self-signed cert so Nexus serves HTTPS?"; then
  # Install Caddy
  if command -v caddy &>/dev/null; then
    ok "Caddy already installed: $(caddy version | awk '{print $1}')"
  else
    run "apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl"
    run "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg"
    run "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list"
    run "apt-get update"
    run "apt-get install -y caddy"
    ok "Caddy installed"
  fi

  # Generate self-signed cert (idempotent — skip if present and not expired).
  run "mkdir -p '$TLS_DIR'"
  regen_cert=1
  if [[ -f "$TLS_CERT" ]]; then
    if openssl x509 -checkend 2592000 -noout -in "$TLS_CERT" &>/dev/null; then
      ok "TLS cert present and valid for >30 days: $TLS_CERT"
      regen_cert=0
    else
      warn "Existing cert expires within 30 days — regenerating"
    fi
  fi

  if [[ $regen_cert -eq 1 ]]; then
    primary_ip=$(hostname -I | awk '{print $1}')
    host_fqdn=$(hostname -f 2>/dev/null || hostname)

    if [[ $DRY_RUN -eq 0 ]]; then
      umask 0077
      openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
        -keyout "$TLS_KEY" \
        -out "$TLS_CERT" \
        -subj "/CN=${host_fqdn}" \
        -addext "subjectAltName=DNS:${host_fqdn},DNS:localhost,IP:127.0.0.1,IP:${primary_ip}" \
        2>/dev/null
      chmod 0640 "$TLS_KEY"
      chmod 0644 "$TLS_CERT"
      chgrp caddy "$TLS_KEY" 2>/dev/null || true
      umask 0022
    fi
    ok "Generated self-signed cert (SAN: ${host_fqdn}, localhost, 127.0.0.1, ${primary_ip})"
    warn "Browsers will show a cert warning — expected for self-signed. Replace with Let's Encrypt later."
  fi

  # Write Caddyfile — TLS terminated here, proxies to Next.js on :3000.
  if [[ $DRY_RUN -eq 0 ]]; then
    cat > "$CADDYFILE" <<EOF
# Auto-generated by deploy/install-hardening.sh
#
# HTTPS termination + security headers + reverse proxy to Nexus on :3000.
# Self-signed cert; auto_https disabled to prevent ACME attempts.
# Swap the tls directive below to Let's Encrypt when ready.
{
    auto_https off
    admin off
}

:443 {
    tls ${TLS_CERT} ${TLS_KEY}

    # Security headers (Phase-2 H6 closure).
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        Permissions-Policy "geolocation=(), microphone=(), camera=()"
        # CSP kept loose for the xterm + recharts assets Nexus ships with.
        # Tighten once you've audited third-party resources.
        Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss: https:; frame-ancestors 'none'"
        # Don't leak backend fingerprint.
        -Server
    }

    # Body size caps: 20 GB for ISO uploads, 12 MB for everything else.
    @uploads path /api/proxmox/nodes/*/storage/*/upload
    request_body @uploads {
        max_size 20GB
    }
    request_body {
        max_size 12MB
    }

    reverse_proxy localhost:3000 {
        # Tell Nexus it's behind TLS so secure-cookie mode engages.
        header_up X-Forwarded-Proto https
        header_up X-Real-IP {remote_host}
        # Long timeouts for exec + script-run routes + xterm WS.
        transport http {
            read_timeout 30m
            write_timeout 30m
        }
    }
}

# HTTP → HTTPS redirect.
:80 {
    redir https://{host}{uri} permanent
}
EOF
  fi
  ok "Caddyfile → $CADDYFILE"

  run "systemctl enable --now caddy"
  if run "systemctl reload caddy"; then
    ok "Caddy running on :443"
  fi

  # Set NODE_ENV=production if possible so Nexus flips secure-cookie mode.
  nexus_env_file=$(systemctl show -p EnvironmentFiles --value nexus.service 2>/dev/null \
                   | awk '{print $1}' | sed 's/(ignore_errors=.*//' | tr -d '(-)')
  if [[ -n "$nexus_env_file" && -f "$nexus_env_file" ]]; then
    if grep -qE '^NODE_ENV=production' "$nexus_env_file"; then
      ok "NODE_ENV=production already set in $nexus_env_file"
    else
      if confirm "Set NODE_ENV=production in $nexus_env_file? (required for Secure cookies)"; then
        run "sed -i '/^NODE_ENV=/d' '$nexus_env_file'"
        run "echo 'NODE_ENV=production' >> '$nexus_env_file'"
        run "systemctl restart nexus"
        ok "NODE_ENV=production set; nexus restarted"
      fi
    fi
  else
    warn "Could not locate Nexus environment file — set NODE_ENV=production manually"
  fi
else
  warn "Skipped HTTPS step — Nexus will remain HTTP on :3000"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Audit keypair
# ──────────────────────────────────────────────────────────────────────────────
step "Audit keypair (asymmetric hybrid log)"

run "mkdir -p '$AUDIT_DIR'"

if [[ -f "$AUDIT_PUBKEY" ]]; then
  ok "Audit public key already present: $AUDIT_PUBKEY"
else
  if confirm "Generate a new RSA-4096 audit keypair?"; then
    if [[ $DRY_RUN -eq 0 ]]; then
      umask 0077
      openssl genrsa -out "$AUDIT_PRIVKEY_TMP" 4096 2>/dev/null
      openssl rsa -in "$AUDIT_PRIVKEY_TMP" -pubout -out "$AUDIT_PUBKEY" 2>/dev/null
      chmod 0644 "$AUDIT_PUBKEY"
      umask 0022
    fi
    ok "Generated keypair"
    ok "Public key → $AUDIT_PUBKEY"
    warn "Private key → $AUDIT_PRIVKEY_TMP"
    echo
    echo "  ${BOLD}${RED}ACTION REQUIRED${RESET} ${BOLD}— move the private key OFF this host NOW${RESET}"
    echo "  The whole point of the hybrid audit log is that whoever owns this"
    echo "  host can't decrypt command history. Leaving the private key here"
    echo "  defeats that."
    echo
    echo "  From your admin workstation:"
    echo "    ${DIM}scp root@$(hostname -I | awk '{print $1}'):${AUDIT_PRIVKEY_TMP} ~/nexus-audit-private.pem${RESET}"
    echo "    ${DIM}ssh root@$(hostname -I | awk '{print $1}') shred -u ${AUDIT_PRIVKEY_TMP}${RESET}"
    echo
  else
    warn "Skipped — Nexus's exec audit log will fall back to metadata-only mode"
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
# Reload
# ──────────────────────────────────────────────────────────────────────────────
step "Reload CrowdSec"

if run "systemctl reload crowdsec"; then
  ok "CrowdSec reloaded"
else
  fail "Reload failed — check: journalctl -xeu crowdsec.service | tail -40"
  exit 3
fi

# ──────────────────────────────────────────────────────────────────────────────
# Verify
# ──────────────────────────────────────────────────────────────────────────────
step "Verify"

if cscli parsers list 2>/dev/null | grep -q 'nexus/login'; then
  ok "Parser nexus/login loaded"
else
  fail "Parser not loaded — check: cscli parsers list | grep nexus"
fi

loaded_scenarios=$(cscli scenarios list 2>/dev/null | grep -c 'nexus/' || true)
if [[ "$loaded_scenarios" -ge 3 ]]; then
  ok "All 3 scenarios loaded"
elif [[ "$loaded_scenarios" -ge 1 ]]; then
  warn "Only $loaded_scenarios/3 scenarios loaded — multi-doc YAML may be an issue"
else
  fail "No nexus scenarios loaded"
fi

echo
step "Done"
echo "  Run ${BOLD}./deploy/nexus-doctor.sh${RESET} any time to check hardening status."
echo "  To test end-to-end, fail a login 10 times from outside the allowlist and"
echo "  watch ${BOLD}cscli decisions list${RESET}."
