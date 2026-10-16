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

Wake-on-LAN needs **wired Ethernet** (the onboard Realtek RTL8111, `enp5s0`). Over Wi-Fi it does not
work on this machine (verified Oct 2026): the Qualcomm QCNFA765 card is powered off in suspend (its
firmware reloads on every resume) and comes back with WoWLAN disabled, even with NetworkManager's
`wake-on-wlan=magic` and the device's `power/wakeup` enabled. The Steam Controller
can also wake the machine from S3 via its USB puck, but that is a local, physical wake.

## 1. Machine side — prepare once Ethernet is plugged in

```bash
# Enable Wake-on-LAN on the cabled interface and print its MAC (persists in NetworkManager):
bash ~/wow-roster-prod/deploy/wake/enable-wol.sh

# Suspend at night (wake with a magic packet or the Steam Controller):
bash ~/wow-roster-prod/deploy/wake/suspend.sh
```

Optional — bring the stack back as soon as the machine resumes. Docker and the containers survived a
real suspend untouched, though, and what is slow is outside the box: the Funnel's **public DNS record
disappears while the machine sleeps**, so after a wake the site answered locally at once but the
public URL took ~6 min to resolve again (restarting the `tailscale` container did not speed it up).
Check the local stack before blaming it, e.g.
`docker exec wow-roster-prod-caddy-1 wget -qO- http://localhost/api/health`.

```bash
sudo cp ~/wow-roster-prod/deploy/wake/resume-hook.sh /etc/systemd/system-sleep/wow-roster
sudo chmod +x /etc/systemd/system-sleep/wow-roster
# Re-copy after a SteamOS image update (/etc persists, but confirm it is still there).
```

Also enable any **"Wake on LAN / PCIe / USB"** option in the firmware/BIOS if present. After
suspending, confirm the magic packet actually wakes it. This machine only offers `s2idle`
(`cat /sys/power/mem_sleep`), so `WOW_SLEEP` has nothing to switch to here; it is kept for other hosts,
where USB-Ethernet adapters only wake from certain sleep states.

### Wi-Fi and cable on the same network: turn Wi-Fi off

SteamOS has no `ethtool`, so `enable-wol.sh` only stores `wake-on-lan=magic` in NetworkManager; it takes
effect when the wired connection is (re)activated: `sudo nmcli connection up "Wired connection 1"`.

Do not leave Wi-Fi connected to the same LAN as the cable. Linux answers ARP for any of its addresses on
any interface (`arp_ignore=0`), so when the cable's DHCP address is checked for conflicts the machine's
own Wi-Fi answers "that IP is mine": NetworkManager logs `conflict detected for IP address … with host
<the Wi-Fi MAC>` and leaves the cable **without IPv4 routes** (IPv6 still works), so traffic keeps going
over Wi-Fi. Seen on this machine on 16 Oct 2026. Fix used: stop Wi-Fi from autoconnecting and bring the
cable up again. SSH over Wi-Fi drops halfway, so run it under `systemd-run`, which outlives the session:

```bash
sudo systemd-run --unit=wow-net-fix bash -c '
  nmcli connection modify "<Wi-Fi connection name>" connection.autoconnect no
  nmcli device disconnect wlan0
  sleep 3
  nmcli connection up "Wired connection 1"'
```

Then reconnect to the cable's address. (Keeping both up would need `net.ipv4.conf.all.arp_ignore=1` and
`arp_announce=2`; Wi-Fi is useless for waking anyway.) Reserve the cable's address for its MAC in the
router's DHCP so the magic packet and SSH always target the same host.

### Suspending over SSH

`suspend.sh` uses `sudo`, which needs a password over SSH. To suspend from another machine without
one, let `deck` suspend from a remote session (otherwise logind's `CanSuspend` answers `challenge`):

```bash
sudo tee /etc/polkit-1/rules.d/50-deck-suspend.rules >/dev/null <<'EOF'
polkit.addRule(function(action, subject) {
    if (subject.user == "deck" &&
        (action.id == "org.freedesktop.login1.suspend" ||
         action.id == "org.freedesktop.login1.suspend-multiple-sessions" ||
         action.id == "org.freedesktop.login1.suspend-ignore-inhibit")) {
        return polkit.Result.YES;
    }
});
EOF
```

Then schedule the suspend in the user's systemd manager, not with `nohup` (a background job dies with
the SSH session before it runs):

```bash
ssh deck@<box> 'systemd-run --user --quiet --on-active=2 systemctl suspend'
```

It takes ~20 s to actually sleep (inhibitors such as `cecd` turning the TV off delay it).

## 2. On-demand wake — send the magic packet

From any device on the same LAN, to the MAC `enable-wol.sh` printed:

- Phone: any "Wake on LAN" app (e.g. send to `<MAC>`, broadcast `255.255.255.255:9`).
- Another Linux box on the LAN: `wakeonlan <MAC>` or `etherwake <MAC>`.
- Router with a WoL page (OpenWrt, Asuswrt-Merlin…): add the machine and press *Wake*.
- Through Tailscale, from another tailnet node **on the same LAN segment**: `tailscale wake <name>`.
- A Windows PC on the LAN (PowerShell, no extra tools):

  ```powershell
  $mac = '<MAC>'.Split(':') | ForEach-Object { [byte]('0x' + $_) }
  $packet = [byte[]](,0xFF * 6) + ($mac * 16)
  $udp = New-Object System.Net.Sockets.UdpClient; $udp.EnableBroadcast = $true
  [void]$udp.Send($packet, $packet.Length, '255.255.255.255', 9); $udp.Close()
  ```

**Verified on 16 Oct 2026** (cable, `s2idle`): a magic packet broadcast from a Windows PC on the LAN woke
the machine 1 s later (`PM: suspend exit`), it answered ping after 11 s, the wired route and every
container came back untouched, and the public URL answered again ~2 min 40 s after the packet (the earlier test over Wi-Fi
took ~6 min, see above).

## 3. Automatic wake on web activity — front door (built)

When you have an always-on Linux host on the LAN (Raspberry Pi, mini-PC, or the router on OpenWrt),
deploy the **wake-proxy** there: it takes over the `wow-roster` Tailscale Funnel, reverse-proxies to
the Steam Machine, and sends a Wake-on-LAN magic packet (showing a small "Arrancando…" page) when the
machine is asleep — so the first visitor wakes it.

It is implemented and ready in [`../wake-proxy/`](../wake-proxy/): a dependency-free Node service plus
its `docker-compose.yml`, `serve.json` and `.env.example`. Follow `deploy/wake-proxy/README.md` for the
one-time cutover (the Steam Machine gives up the `wow-roster` name and keeps serving Caddy on its LAN
IP; the front door claims the name and wakes it on demand).
