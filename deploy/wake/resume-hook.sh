#!/usr/bin/env bash
# systemd-sleep hook: the moment the machine resumes, bring the stack and the Tailscale tunnel back
# so the site is reachable fast. The autoheal sidecar would also recover within ~a minute; this
# makes it immediate. systemd runs this as root with: $1 = pre|post, $2 = suspend|hibernate|…
#
# Install once (writable on SteamOS; survives reboots, not image updates):
#   sudo cp ~/wow-roster-prod/deploy/wake/resume-hook.sh /etc/systemd/system-sleep/wow-roster
#   sudo chmod +x /etc/systemd/system-sleep/wow-roster
# After a SteamOS image update, re-copy it.
set -u

[ "${1:-}" = "post" ] || exit 0

# Adjust if the production folder lives elsewhere.
DEPLOY_PATH="${WOW_DEPLOY_PATH:-/home/deck/wow-roster-prod}"
LOG=/tmp/wow-roster-resume.log
cd "$DEPLOY_PATH" 2>/dev/null || { echo "$(date -Is) resume: $DEPLOY_PATH not found" >>"$LOG"; exit 0; }

# Let the network (and, on Wi-Fi, the reconnection) settle before poking Tailscale.
sleep 10
compose=(docker compose -f docker-compose.prod.yml -f docker-compose.home.yml)
{
  echo "$(date -Is) resume: bringing the stack back up"
  "${compose[@]}" up -d
  "${compose[@]}" restart tailscale
} >>"$LOG" 2>&1 || true
