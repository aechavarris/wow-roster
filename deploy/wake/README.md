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

## 3. (Later) Automatic wake on web activity — front-door design

When you have an always-on Linux host on the LAN (Raspberry Pi, mini-PC, or the router on OpenWrt),
move the **front door** there so it can wake the machine on the first request:

1. Run **Tailscale on the front door** and give *it* the `wow-roster` hostname + Funnel (move the
   `tailscale` service there; the Steam Machine then runs the app **without** its own Funnel and just
   serves Caddy on the LAN).
2. The front door runs a tiny **wake-proxy**: on each request, if the machine's app is reachable
   (`nc -z <machine-ip> 80`), reverse-proxy to it; if not, send `wakeonlan <machine-MAC>` and return a
   small *"Waking the server, refresh in ~30 s"* page (HTTP 503 + `Retry-After: 30`). Idle the machine
   back to sleep with a cron that suspends it after N minutes with no connections.

Sketch (front door, Caddy + a shell handler is enough):

```
# pseudo-Caddyfile on the always-on front door
wow-roster.tail3d07cb.ts.net {
    @up  `nc -z <machine-ip> 80`        # reachable → serve
    handle @up { reverse_proxy <machine-ip>:80 }
    handle {                            # down → fire WoL and ask the visitor to retry
        respond "Waking the server, refresh in ~30 seconds…" 503 { close }
        exec wakeonlan <machine-MAC>    # via a small sidecar / hook
    }
}
```

This keeps the public URL unchanged, lets the machine sleep whenever idle, and wakes it the instant
someone browses in. It is documented here rather than built, because it needs that always-on host —
set it up when the hardware is in place and we can wire it then.
