# Wake-proxy — the always-on front door

Runs on a small device that **never sleeps** (a Raspberry Pi, a mini-PC, or the router on OpenWrt),
on the **same LAN** as the Steam Machine. It:

1. Holds the public URL `https://wow-roster.tail3d07cb.ts.net` via **Tailscale Funnel** on this host.
2. On each request, probes the Steam Machine. If it answers, it **reverse-proxies** to it. If it is
   asleep, it sends a **Wake-on-LAN** magic packet and shows a small *"Arrancando…"* page that
   auto-refreshes until the machine is up.

This is what makes "wake automatically when a visitor hits the web" possible: the front door is the
thing that stays awake and holds the URL, so it can see the request and wake the real server. The
Steam Machine can then sleep whenever you want and still come back on demand.

## Requirements

- An always-on Linux host on the LAN with Docker + the Compose plugin.
- The Steam Machine on **wired Ethernet** with Wake-on-LAN enabled (`deploy/wake/enable-wol.sh`),
  and a **static DHCP lease** (so its LAN IP never changes).
- A reusable Tailscale auth key.

## Status (16 Oct 2026): not deployed yet

What is ready and what is missing before the cutover:

- **Done**: the Steam Machine is on wired Ethernet with Wake-on-LAN verified (a magic packet from the LAN
  woke it in 1 s; see `deploy/wake/README.md`).
- **Missing: the front-door device.** There is no always-on host on the LAN or tailnet. The router (Digi's
  ZTE F6705) cannot be the front door: closed firmware, no Tailscale, no containers, no OpenWrt. A
  **Raspberry Pi Zero 2 W** (~1 W; with a USB-Ethernet adapter if possible) is enough; a Pi 4/5 also works.
  - Rejected router-only alternative: port-forward 80/443 to the box and wake on unicast (`wol u`) without
    Funnel. Digi usually puts customers behind CG-NAT, it exposes the home IP, stray traffic would keep
    waking the box, and the first request would hang while it wakes.
- **Missing: the box is not reachable on the LAN.** `docker-compose.home.yml` gives Caddy no host ports
  (`ports: !reset []`, traffic only arrives via Funnel), so `BACKEND_HOST:80` would not answer. The cutover
  needs a deploy toggle that publishes Caddy on the LAN **and** keeps the box's `tailscale` service stopped
  (the deploy job restarts it today, which would re-claim the `wow-roster` name).

## Cutover (do this once, in order)

1. **On the Steam Machine**: enable WoL and note the wired MAC:
   ```bash
   bash ~/wow-roster-prod/deploy/wake/enable-wol.sh
   ```
   Give up the `wow-roster` tailnet name so the front door can take it — stop its Tailscale and keep
   it stopped (Caddy must then be published on the LAN: see "Status" above, not wired yet):
   ```bash
   cd ~/wow-roster-prod
   docker compose -f docker-compose.prod.yml -f docker-compose.home.yml stop tailscale
   ```
   > A later `deploy` restarts this container. When you are ready to run the front door for good,
   > ping me and we'll wire a clean toggle into the deploy so the machine never re-claims the name.
   Then in the Tailscale admin console, **delete** the Steam Machine's `wow-roster` node.

2. **On the front-door host**: copy this `deploy/wake-proxy/` folder over, create `.env` from
   `.env.example` (the machine's LAN IP, its wired MAC, a reusable `TS_AUTHKEY`), and start it:
   ```bash
   cp .env.example .env && nano .env
   docker compose up -d --build
   ```
   It registers as `wow-roster`, Tailscale fetches the cert, and Funnel serves the public URL →
   wake-proxy → the Steam Machine.

3. **Verify**: with the machine awake, open `https://wow-roster.tail3d07cb.ts.net` (normal site).
   Suspend the machine (`deploy/wake/suspend.sh`), open the URL again: you should see *"Arrancando…"*,
   the machine wakes, and within a few seconds it loads normally.

4. **Sleep schedule**: suspend the machine at night with `deploy/wake/suspend.sh` (by hand or a cron).
   The front door wakes it whenever someone browses in. Install `deploy/wake/resume-hook.sh` on the
   machine so its stack is back fast after each wake.

## Configuration (env)

| Variable | Default | Meaning |
|---|---|---|
| `BACKEND_HOST` | — (required) | Steam Machine LAN IP |
| `BACKEND_PORT` | `80` | Caddy port on the machine |
| `TARGET_MAC` | — (required) | Steam Machine wired MAC |
| `WOL_BROADCAST` | `255.255.255.255` | Set to the subnet broadcast (e.g. `192.168.1.255`) if the limited broadcast does not reach it |
| `PROBE_TIMEOUT_MS` | `800` | How long to wait for the backend before deciding it is asleep |
| `WAKE_DEBOUNCE_MS` | `5000` | Minimum gap between magic packets |
| `RETRY_AFTER_S` | `8` | Auto-refresh interval on the waking page |

## Notes & limits

- Uses **host networking** so the magic packet reaches the LAN and Tailscale can reach the proxy at
  `127.0.0.1:8080`.
- Plain HTTP proxy (no WebSocket upgrade) — the app does not need WS in production.
- The magic packet only wakes the machine over **wired Ethernet**; Wi-Fi WoL is unreliable.
- `node --test deploy/wake-proxy/server.test.js` covers the magic-packet builder.
