#!/usr/bin/env bash
# Enable Wake-on-LAN on the wired Ethernet interface so the machine can be woken by a magic packet
# once it is on a cable. SteamOS uses NetworkManager, which persists the setting in the connection
# profile (survives reboots); this also applies it live for the current session.
#
# Run once, AFTER plugging in Ethernet (it uses sudo):
#   bash ~/wow-roster-prod/deploy/wake/enable-wol.sh
#
# It prints the MAC address — note it down: that is what you send the magic packet to.
set -euo pipefail

# Pick the first wired interface with a carrier (cable actually plugged in).
iface=""
for d in /sys/class/net/*; do
  name=$(basename "$d")
  [ "$name" = "lo" ] && continue
  # Skip wireless devices (they have a wireless/ dir or a phy80211 link).
  { [ -d "$d/wireless" ] || [ -L "$d/phy80211" ]; } && continue
  [ -e "$d/device" ] || continue
  if [ "$(cat "$d/carrier" 2>/dev/null || echo 0)" = "1" ]; then iface="$name"; break; fi
done

if [ -z "$iface" ]; then
  echo "No wired interface with a cable detected. Plug in Ethernet and retry." >&2
  echo "Interfaces present:" >&2; ls /sys/class/net >&2
  exit 1
fi

mac=$(cat "/sys/class/net/$iface/address")
echo "Wired interface: $iface   MAC: $mac"

# Persist in NetworkManager so WoL is re-applied on every link-up / reboot.
con=$(nmcli -g GENERAL.CONNECTION device show "$iface" 2>/dev/null || true)
if [ -n "${con:-}" ] && [ "$con" != "--" ]; then
  sudo nmcli connection modify "$con" 802-3-ethernet.wake-on-lan magic
  echo "NetworkManager connection '$con': wake-on-lan=magic (persists across reboots)."
else
  echo "Warning: no NetworkManager connection for $iface; applying for this session only." >&2
fi

# Apply live now too, if ethtool is available.
if command -v ethtool >/dev/null 2>&1; then
  sudo ethtool -s "$iface" wol g && echo "ethtool: magic-packet WoL enabled now on $iface."
  echo "Current WoL flag:"; sudo ethtool "$iface" | grep -i 'Wake-on' || true
else
  echo "Note: ethtool not installed; NetworkManager applies WoL on the next link-up." >&2
fi

cat <<EOF

DONE.
- Target MAC for the magic packet: $mac
- Also enable any "Wake on LAN / PCIe / USB" option in the machine's BIOS/firmware if present.
- USB-to-Ethernet adapters only wake from suspend in some sleep states: after suspending, test
  waking it (see deploy/wake/README.md). If it will not wake from "deep" (S3), try s2idle.
EOF
