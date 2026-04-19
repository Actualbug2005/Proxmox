# Installation

Nexus ships as a prebuilt Next.js bundle. The installer downloads the latest GitHub Release tarball, unpacks it under `/opt/nexus/releases/<tag>/`, flips a `current` symlink, and installs a `systemd` unit. Your `.env.local` persists across upgrades.

Three install paths below. Pick the one that fits your setup.

## Path 1 — One-liner on the Proxmox host (recommended)

On the Proxmox host, as root:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Actualbug2005/Proxmox/main/install.sh)
```

The installer:

1. Installs Node.js 22 LTS if missing.
2. Downloads the latest Nexus release tarball to `/opt/nexus/releases/<tag>/`.
3. Flips `/opt/nexus/current` → the new release.
4. Writes `/opt/nexus/.env.local` with an auto-generated `JWT_SECRET` (preserved on future runs).
5. Installs `/etc/systemd/system/nexus.service` and `/usr/local/bin/nexus-update`.
6. Opens the chosen port (default `3000`) in the PVE host firewall.

When it finishes, open `http://<your-pve-ip>:3000` and log in with any PVE credential.

## Path 2 — Manual install

If you need to pin a specific version or can't run the installer non-interactively, install manually.

```bash
# 1. Install Node.js 22 (Debian/Ubuntu example)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# 2. Create the directory layout
mkdir -p /opt/nexus/releases
cd /opt/nexus/releases

# 3. Download a specific release tarball (replace v0.28.1 with your target)
TAG=v0.28.1
curl -fsSL "https://github.com/Actualbug2005/Proxmox/releases/download/${TAG}/nexus-${TAG}.tar.gz" | tar -xz
ln -sfn /opt/nexus/releases/${TAG} /opt/nexus/current

# 4. Create .env.local
cat > /opt/nexus/.env.local <<EOF
PROXMOX_HOST=localhost
PORT=3000
JWT_SECRET=$(openssl rand -base64 36)
EOF
chmod 600 /opt/nexus/.env.local

# 5. Install the systemd unit
cat > /etc/systemd/system/nexus.service <<'EOF'
[Unit]
Description=Nexus - Proxmox Management UI
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/nexus/current
EnvironmentFile=/opt/nexus/.env.local
ExecStart=/usr/bin/node --experimental-strip-types server.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now nexus
```

Tail the logs while it starts:

```bash
journalctl -u nexus -f
```

## Path 3 — Inside an LXC (isolation-first)

Running Nexus inside a privileged LXC on the Proxmox host keeps the UI's dependencies out of the host OS. The trade-off is one extra network hop.

1. **Create a privileged Debian 12 LXC.** 1 core, 512 MiB RAM, 4 GiB disk is enough.
2. **Inside the LXC**, follow Path 2 above.
3. **Set `PROXMOX_HOST`** to the PVE host's LAN IP (not `localhost` — `localhost` inside the LXC isn't PVE):

   ```bash
   # /opt/nexus/.env.local
   PROXMOX_HOST=192.0.2.10
   ```

4. **Firewall:** open port `3000` on the LXC's interface and make sure the LXC can reach the host's `:8006`.
5. **TLS:** PVE serves a self-signed cert — no extra config needed; Nexus scopes the TLS bypass to `pveFetch` only, so outbound calls to anything else still validate normally.

## Uninstall

```bash
# Stop and remove the service
systemctl disable --now nexus
rm /etc/systemd/system/nexus.service
systemctl daemon-reload

# Remove installed files
rm -rf /opt/nexus
rm -f /usr/local/bin/nexus-update

# Close the firewall port (adjust port if you changed it)
pve-firewall localnet  # find the rule number, then:
# Edit /etc/pve/firewall/cluster.fw and remove the nexus line
```

Your PVE host, VMs, CTs, storage, and settings are untouched — Nexus only ever calls the public PVE API and stores nothing in PVE's data directories.

## Next

- **[Configuration](Configuration)** — env vars, Redis, TLS, ports.
- **[Feature Tour](Feature-Tour)** — what to try first.
