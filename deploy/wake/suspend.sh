#!/usr/bin/env bash
# Suspend the machine to RAM at night. Wake it with a Wake-on-LAN magic packet (needs Ethernet +
# deploy/wake/enable-wol.sh) or with the Steam Controller's Steam button.
#
#   bash ~/wow-roster-prod/deploy/wake/suspend.sh
#
# The sleep state that still lets the NIC (or the controller's USB puck) wake the machine is
# hardware-specific. By default this leaves the firmware's choice untouched. If Wake-on-LAN does
# not wake it, re-run with WOW_SLEEP=deep (forces S3) or WOW_SLEEP=s2idle and test which one works:
#   WOW_SLEEP=deep bash ~/wow-roster-prod/deploy/wake/suspend.sh
set -euo pipefail

if [ -n "${WOW_SLEEP:-}" ] && [ -w /sys/power/mem_sleep ]; then
  if grep -qw "$WOW_SLEEP" /sys/power/mem_sleep; then
    echo "$WOW_SLEEP" | sudo tee /sys/power/mem_sleep >/dev/null
    echo "Sleep state set to: $(cat /sys/power/mem_sleep)"
  else
    echo "Requested state '$WOW_SLEEP' not in $(cat /sys/power/mem_sleep); leaving as is." >&2
  fi
fi

echo "Suspending now…"
sudo systemctl suspend
