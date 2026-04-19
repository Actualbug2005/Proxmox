# FAQ

## Does Nexus replace the stock PVE UI?

**No.** Nexus runs alongside the stock PVE UI at `:8006`. It never modifies PVE itself, only calls the public PVE API. You can use both UIs simultaneously — switch tabs, nothing breaks.

## Which Proxmox versions are supported?

PVE 8.x. Nexus uses only documented PVE API endpoints, so earlier 7.x may work, but it's not tested.

## Can I run Nexus without systemd?

Yes. `npm run start` in `/opt/nexus/current` runs the server in the foreground. You can wrap it in anything (Docker, launchd, pm2, tmux). systemd is just the default because every PVE host already has it.

## Does it work on a multi-node cluster?

Yes. Nexus pulls from `/cluster/resources` and shows all nodes, VMs, CTs, and storages as one tree. You only need **one** Nexus install to manage the whole cluster — point it at any node that can reach `/api2/json/cluster/*`.

## Can I run multiple Nexus instances (HA / behind a load balancer)?

Yes, if you set `REDIS_URL`. Without Redis, each instance has its own in-memory session store, which means a user logged into instance A would appear logged-out when the load balancer routes them to instance B. With Redis, sessions are shared and every instance is interchangeable.

## Login fails even though my PVE credentials are correct

Three common causes:

1. **Wrong realm.** PVE has `pam` (Linux users on the host) and `pve` (Proxmox-internal accounts) realms. The login form picks the realm from the dropdown — check you're on the right one. `root@pam` is almost always the one you want for day-to-day admin.
2. **`PROXMOX_HOST` unreachable.** Check `curl -k https://<PROXMOX_HOST>:8006/api2/json/version` from the Nexus host. If that fails, fix networking before anything else.
3. **Two-factor auth.** TOTP is supported; the login form shows the code box after your password is verified. U2F is not yet supported.

## Why can't Nexus reach PVE from inside an LXC?

`PROXMOX_HOST=localhost` refers to the LXC's own loopback, not the PVE host. Set `PROXMOX_HOST` to the **PVE host's LAN IP** (e.g. `192.0.2.10`) and make sure the LXC's network can reach the host's port 8006. If you bridged the LXC to `vmbr0`, it usually can by default.

## Is my PVE password stored?

**No.** Nexus logs in with your password once, receives a PVE session ticket (`PVEAuthCookie`), and stores only the opaque ticket in the session store. The password is discarded immediately after the login API call.

Tickets expire per PVE's own policy (default 2 h); Nexus re-auth's transparently within their valid window.

## Can I run Nexus behind Cloudflare Tunnel / a reverse proxy?

Yes. That's actually why the [fire-and-forget script execution](Community-Scripts) model exists — Cloudflare Tunnel drops any HTTP request at 100 s, and a lot of Community Scripts take longer than that. Nexus returns a `jobId` in under a second and streams status separately, so the tunnel never kills a script mid-run.

For the reverse proxy itself: forward to `localhost:3000`, terminate TLS at the proxy, leave `NEXUS_SECURE_COOKIES=true`. Nexus only needs to know the request came over HTTPS at the boundary.

## How do I turn off alerts?

Every alert rule has an **Enabled** toggle on its edit page. Flip it off and the rule stops evaluating. If you want alerts entirely gone: delete every rule from the alerts page.

## How do I report a bug?

Open an issue on the main repo: <https://github.com/Actualbug2005/Proxmox/issues>. Include your Nexus version (from `/api/health`), your PVE version (`pveversion`), and whatever logs `journalctl -u nexus --since '10 min ago'` produced.
