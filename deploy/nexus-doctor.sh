#!/usr/bin/env bash
# Nexus hardening doctor — read-only health check for the deployed stack.
#
# Safe to run any time; changes nothing. Reports on:
#   - App-layer: NODE_ENV, secure-cookie setting, nexus.service running
#   - L3 tier:   crowdsec running, parser + scenarios loaded, bouncer active,
#                allowlist populated, recent decisions
#   - Audit log: pubkey installed, private key NOT on this host
#   - Ingress:   reverse proxy presence on :443 (best-effort detection)
#
# Exit codes:
#   0 — all checks passed or warn-only
#   1 — at least one FAIL (critical hardening gap)

set -uo pipefail

if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'
  RESET=$'\e[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

PASS=0; WARN=0; FAIL=0

ok()   { echo -e "  ${GREEN}[✓]${RESET} $*"; PASS=$((PASS+1)); }
warn() { echo -e "  ${YELLOW}[⚠]${RESET} $*"; WARN=$((WARN+1)); }
bad()  { echo -e "  ${RED}[✗]${RESET} $*"; FAIL=$((FAIL+1)); }
hint() { echo -e "      ${DIM}$*${RESET}"; }
hdr()  { echo; echo -e "${BOLD}$*${RESET}"; }

# ──────────────────────────────────────────────────────────────────────────────
hdr "Nexus service"

if systemctl is-active --quiet nexus.service; then
  ok "nexus.service is active"
else
  bad "nexus.service not running"
  hint "systemctl status nexus.service"
fi

nexus_env_file=$(systemctl show -p EnvironmentFiles --value nexus.service 2>/dev/null \
                 | awk '{print $1}' | sed 's/(ignore_errors=.*//' | tr -d '(-)')
if [[ -n "$nexus_env_file" && -f "$nexus_env_file" ]]; then
  if grep -qE '^NODE_ENV=production' "$nexus_env_file"; then
    ok "NODE_ENV=production in $nexus_env_file"
  else
    warn "NODE_ENV is NOT production (cookies will not be Secure)"
    hint "Edit $nexus_env_file and set NODE_ENV=production"
  fi

  if grep -qE '^NEXUS_SECURE_COOKIES=false' "$nexus_env_file"; then
    warn "NEXUS_SECURE_COOKIES=false is set — overrides NODE_ENV"
  fi
else
  warn "Could not locate Nexus environment file via systemd"
fi

# ──────────────────────────────────────────────────────────────────────────────
hdr "CrowdSec"

if ! command -v cscli &>/dev/null; then
  warn "cscli not installed — L3 tier skipped (app-layer controls still active)"
  hint "Run deploy/install-hardening.sh to set up the L3 stack"
else
  if systemctl is-active --quiet crowdsec; then
    ok "crowdsec service active"
  else
    bad "crowdsec service inactive"
  fi

  if cscli parsers list 2>/dev/null | grep -q 'nexus/login'; then
    ok "Parser nexus/login loaded"
  else
    bad "Parser nexus/login missing"
    hint "cp /opt/nexus/deploy/crowdsec/parsers/s01-parse/nexus-login.yaml /etc/crowdsec/parsers/s01-parse/"
  fi

  scenario_count=$(cscli scenarios list 2>/dev/null | grep -c 'nexus/' || true)
  case "$scenario_count" in
    3) ok "All 3 nexus scenarios loaded (login-bf, login-slowbf, credential-stuffing)" ;;
    0) bad "No nexus scenarios loaded" ;;
    *) warn "Only $scenario_count/3 scenarios loaded" ;;
  esac

  if cscli allowlists inspect nexus-homelab &>/dev/null; then
    # grep -c prints "0" AND exits 1 when there are no matches; `|| true`
    # keeps the pipeline alive without appending a second "0" via echo.
    allowlist_size=$(cscli allowlists inspect nexus-homelab 2>/dev/null \
                     | grep -cE '^\s*[0-9a-f:.]+/[0-9]+|^\s*[0-9a-f:.]+\s+' || true)
    allowlist_size=${allowlist_size:-0}
    if [[ "$allowlist_size" -ge 1 ]]; then
      ok "Allowlist nexus-homelab has $allowlist_size entries"
    else
      warn "Allowlist nexus-homelab exists but is empty"
    fi
  else
    warn "Allowlist nexus-homelab not found — risk of self-ban"
    hint "cscli allowlists create nexus-homelab"
  fi

  active_bans=$(cscli decisions list 2>/dev/null | grep -c '^|' || true)
  active_bans=${active_bans:-0}
  if [[ "$active_bans" -gt 2 ]]; then
    # `cscli decisions list` wraps rows in 2 header lines of pipes; subtract
    # them for an accurate count.
    real_bans=$((active_bans - 2))
    ok "$real_bans active decision(s) — 'cscli decisions list' to inspect"
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
hdr "Firewall bouncer"

if command -v dpkg &>/dev/null && \
   dpkg -l crowdsec-firewall-bouncer-nftables 2>/dev/null | grep -q '^ii'; then
  if systemctl is-active --quiet crowdsec-firewall-bouncer; then
    ok "nftables bouncer active"
  else
    bad "nftables bouncer installed but not running"
  fi
else
  warn "No firewall bouncer detected"
  hint "CrowdSec decisions are being logged but not enforced at L3"
fi

# ──────────────────────────────────────────────────────────────────────────────
hdr "Audit keypair"

AUDIT_PUBKEY="/etc/nexus/audit-pubkey.pem"

if [[ -f "$AUDIT_PUBKEY" ]]; then
  ok "Audit public key present: $AUDIT_PUBKEY"
else
  warn "No audit public key — /api/exec + /api/scripts/run log metadata only"
  hint "Run deploy/install-hardening.sh to generate one"
fi

# Loud warning if the private key is still anywhere obvious on this host.
stray_privkeys=$(find /root /home /etc/nexus /tmp -maxdepth 4 \
                 -name 'audit-private.pem' -o -name 'audit-privkey.pem' \
                 2>/dev/null | head -5)
if [[ -n "$stray_privkeys" ]]; then
  bad "AUDIT PRIVATE KEY IS ON THIS HOST — defeats the hybrid log design"
  while IFS= read -r path; do
    hint "$path"
  done <<< "$stray_privkeys"
  hint "Move it off-box then: shred -u <path>"
else
  ok "No audit private key found on this host"
fi

# ──────────────────────────────────────────────────────────────────────────────
hdr "TLS / HTTPS"

TLS_CERT="/etc/nexus/tls/cert.pem"

if [[ -f "$TLS_CERT" ]]; then
  # `-checkend 0` returns non-zero if already expired.
  if openssl x509 -checkend 0 -noout -in "$TLS_CERT" &>/dev/null; then
    expires=$(openssl x509 -enddate -noout -in "$TLS_CERT" | cut -d= -f2)
    ok "TLS cert present (expires: $expires)"
    # Warn if <30 days from expiry.
    if ! openssl x509 -checkend 2592000 -noout -in "$TLS_CERT" &>/dev/null; then
      warn "Cert expires within 30 days — regenerate with install-hardening.sh"
    fi
  else
    bad "TLS cert has expired"
  fi
else
  warn "No TLS cert at $TLS_CERT — Nexus is HTTP-only"
fi

if systemctl is-active --quiet caddy; then
  ok "Caddy service active"
elif command -v caddy &>/dev/null; then
  warn "Caddy installed but not running"
else
  warn "Caddy not installed — no HTTPS reverse proxy"
fi

# ──────────────────────────────────────────────────────────────────────────────
hdr "Ingress (best-effort detection)"

listening_443=$(ss -ltnp 2>/dev/null | awk '$4 ~ /:443$/ {print $6}' | head -1)
if [[ -n "$listening_443" ]]; then
  proc=$(echo "$listening_443" | grep -oE 'users:\(\("[^"]+"' | sed 's/.*"//')
  ok "Something is listening on :443 → $proc"
else
  warn "Nothing on :443 — if you're not fronted by Cloudflare/Tailscale, Nexus is HTTP-only"
fi

# Flag direct :3000 exposure — should only be loopback after Caddy is in front.
listening_3000=$(ss -ltn 2>/dev/null | awk '$4 ~ /:3000$/ {print $4}' | head -1)
if [[ -n "$listening_3000" && "$listening_3000" != 127.0.0.1:3000 && "$listening_3000" != "[::1]:3000" ]]; then
  warn ":3000 is bound to $listening_3000 — anyone on the LAN can bypass Caddy"
  hint "Bind Nexus to 127.0.0.1:3000 in nexus.service or add an nftables rule"
fi

# Detect common ZTNA / tunnel clients.
if pgrep -x cloudflared &>/dev/null; then
  ok "cloudflared (Cloudflare Tunnel) running"
fi
if pgrep -x tailscaled &>/dev/null; then
  ok "tailscaled running — Nexus reachable via tailnet"
fi

# ──────────────────────────────────────────────────────────────────────────────
hdr "Summary"
total=$((PASS + WARN + FAIL))
echo "  ${GREEN}${PASS} passed${RESET} · ${YELLOW}${WARN} warning${RESET} · ${RED}${FAIL} failed${RESET} (${total} checks)"

[[ $FAIL -eq 0 ]] || exit 1
