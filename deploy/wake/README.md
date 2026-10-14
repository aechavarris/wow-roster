# Suspend at night, wake on demand (and, later, on web activity)

Scripts and notes to let the home server (the SteamOS Steam Machine) sleep at night and come back
when needed. **Nothing here is wired into the deploy automatically** — these are host actions you run
by hand when you are ready (notably, once the machine is on a wired Ethernet connection).

## The hard constraint (read this first)

The public site is published through **Tailscale Funnel, which terminates on the machine itself**.
Inbound visitor traffic arrives over the machine's own Tailscale tunnel. When the machine sleeps,
that tunnel is down, Tailscale returns an error to the visitor, and **nothing on your LAN — not even
the router — ever sees the attempt**. So the router cannot "notice a visitor and wake the machine".

That splits the goal into two layers:

- **On-demand / remote wake** — *achievable with the machine + router once it is on Ethernet.*
  You (a phone app, the router, or another Tailscale node on the LAN) send a Wake-on-LAN magic
  packet when you want it up.
- **Automatic wake on web activity** — *needs an always-on "front door"* that holds the public URL
  and wakes the machine when a request arrives. A stock router can't do this; a Raspberry Pi (or the
  router running OpenWrt + Tailscale) can. Design in the last section.

Wake-on-LAN needs **wired Ethernet**: over Wi-Fi it is unreliable/unsupported. The Steam Controller
can also wake the machine from S3 via its USB puck, but that is a local, physical wake.

## 1. Machine side — prepare once Ethernet is plugged in

```bash
# Enable Wake-on-LAN on the cabled interface and print its MAC (persists in NetworkManager):
bash ~/wow-roster-prod/deploy/wake/enable-wol.sh

# Suspend at night (wake with a magic packet or the Steam Controller):
bash ~/wow-roster-prod/deploy/wake/suspend.sh
```

Optional — make the site come back instantly on resume (otherwise autoheal recovers it in ~1 min):

```bash
sudo cp ~/wow-roster-prod/deploy/wake/resume-hook.sh /etc/systemd/system-sleep/wow-roster
sudo chmod +x /etc/systemd/system-sleep/wow-roster
# Re-copy after a SteamOS image update (/etc persists, but confirm it is still there).
```

Also enable any **"Wake on LAN / PCIe / USB"** option in the firmware/BIOS if present. After
suspending, confirm the magic packet actually wakes it; if not, try `WOW_SLEEP=deep` or
`WOW_SLEEP=s2idle` with `suspend.sh` — USB-Ethernet adapters only wake from certain sleep states.

## 2. On-demand wake — send the magic packet

From any device on the same LAN, to the MAC `enable-wol.sh` printed:

- Phone: any "Wake on LAN" app (e.g. send to `<MAC>`, broadcast `255.255.255.255:9`).
- Another Linux box on the LAN: `wakeonlan <MAC>` or `etherwake <MAC>`.
- Router with a WoL page (OpenWrt, Asuswrt-Merlin…): add the machine and press *Wake*.
- Through Tailscale, from another tailnet node **on the same LAN segment**: `tailscale wake <name>`.

## 3. Automatic wake on web activity — front door (built)

When you have an always-on Linux host on the LAN (Raspberry Pi, mini-PC, or the router on OpenWrt),
deploy the **wake-proxy** there: it takes over the `wow-roster` Tailscale Funnel, reverse-proxies to
the Steam Machine, and sends a Wake-on-LAN magic packet (showing a small "Arrancando…" page) when the
machine is asleep — so the first visitor wakes it.

It is implemented and ready in [`../wake-proxy/`](../wake-proxy/): a dependency-free Node service plus
its `docker-compose.yml`, `serve.json` and `.env.example`. Follow `deploy/wake-proxy/README.md` for the
one-time cutover (the Steam Machine gives up the `wow-roster` name and keeps serving Caddy on its LAN
IP; the front door claims the name and wakes it on demand).
