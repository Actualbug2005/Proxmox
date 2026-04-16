# CrowdSec bouncers for Nexus

A *bouncer* is the component that enforces CrowdSec's decisions — it pulls
the blocked-IP list from the CrowdSec API and drops traffic at whatever
layer it lives in (iptables, nginx, Caddy, Traefik, Cloudflare).

You typically want **two** bouncers active:

1. **Firewall bouncer** — iptables/nftables drops. Catches EVERYTHING,
   including probes that never reach the reverse proxy.
2. **Reverse-proxy bouncer** — application-layer refuse. Returns 403 with a
   human-readable page so legitimate users who trip a false positive can see
   what's going on.

The bouncer configs below assume CrowdSec is already installed and running
on the PVE host. Install with:

```bash
curl -s https://install.crowdsec.net | sudo sh
sudo apt install crowdsec
```

## 1. Firewall bouncer (L3/L4)

Drops at nftables. Runs independently of whatever reverse proxy you use.

```bash
sudo apt install crowdsec-firewall-bouncer-nftables
```

Config lives at `/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml`.
Defaults are sensible; only change `mode` if you use iptables instead of nft:

```yaml
mode: nftables   # or 'iptables' / 'ipset'
update_frequency: 10s
log_level: info
```

## 2. Reverse-proxy bouncer

### Caddy

```bash
sudo curl -o /usr/share/caddy/crowdsec-bouncer.caddy \
  https://raw.githubusercontent.com/hslatman/caddy-crowdsec-bouncer/main/README.md
```

Add to your Caddyfile (alongside `deploy/caddy/Caddyfile`):

```caddyfile
{
    order crowdsec before basicauth
    crowdsec {
        api_url http://127.0.0.1:8080
        api_key REPLACE_WITH_BOUNCER_API_KEY
        ticker_interval 10s
        # The bouncer fails open if CrowdSec is unreachable — safer for
        # operator-facing sites. Flip to `fail_closed` if you'd rather
        # take the outage than let IPs in during a CrowdSec failure.
    }
}

nexus.example.lan {
    crowdsec
    # ... rest of your nexus site config
}
```

Generate the API key:
```bash
sudo cscli bouncers add caddy-nexus
# Copy the key into the caddyfile.
sudo systemctl reload caddy
```

### nginx

```bash
sudo apt install crowdsec-nginx-bouncer
sudo cscli bouncers add nginx-nexus
# Paste key into /etc/crowdsec/bouncers/crowdsec-nginx-bouncer.conf
sudo systemctl reload nginx
```

### Traefik

Add to `deploy/traefik/dynamic.yml`:

```yaml
http:
  middlewares:
    crowdsec:
      plugin:
        crowdsec-bouncer-traefik-plugin:
          enabled: true
          crowdsecMode: stream
          crowdsecLapiKey: REPLACE_WITH_BOUNCER_API_KEY
          crowdsecLapiHost: crowdsec:8080
          crowdsecLapiScheme: http
```

Then chain it into Nexus's middleware list in the compose labels:

```yaml
- traefik.http.routers.nexus.middlewares=crowdsec@file,authelia@file,nexus-ratelimit@file,nexus-security-headers@file
```

## 3. Whitelists

Add your own IPs + the tailnet range to CrowdSec's allowlist so you don't
self-ban:

```bash
sudo cscli allowlists create nexus-homelab
sudo cscli allowlists items add --ip 100.64.0.0/10      # Tailscale CGNAT range
sudo cscli allowlists items add --ip 10.0.0.0/8          # your LAN
sudo cscli allowlists items add --ip YOUR_STATIC_HOME_IP
sudo systemctl reload crowdsec
```

## 4. Verify the pipeline

After everything is deployed:

```bash
# Fail a login 10 times:
for i in $(seq 10); do
  curl -s -k https://nexus.example.lan/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"bogus","password":"bogus"}'
done

# Confirm the scenario fired:
sudo cscli decisions list

# Expect a line like:
#  ID  source           scope     value            reason       action    duration
#  42  crowdsec         Ip        203.0.113.42     nexus/login-bf  ban   5m
```

If you see the ban, the parser → scenario → bouncer chain is working.
