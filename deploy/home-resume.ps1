# Runs when Windows resumes from sleep (scheduled task, see deploy/register-resume-task.ps1).
# After a sleep the Tailscale tunnel and the app's open connections can be dead even though the
# containers still run. This waits for Docker, starts anything that stopped and restarts the
# Tailscale container so the Funnel reconnects; the healthchecks + autoheal cover the rest.
$ErrorActionPreference = 'Continue'
$deployPath = Split-Path -Parent $PSScriptRoot
$log = Join-Path $deployPath 'resume.log'
function Log($message) { "$(Get-Date -Format s) $message" | Out-File -Append -Encoding utf8 $log }

Set-Location $deployPath
Log 'Resumed from sleep'

# Docker Desktop needs a moment to bring its VM back.
$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
  docker info *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 10
}
if ($LASTEXITCODE -ne 0) { Log 'Docker did not come back within 5 minutes'; exit 1 }

# Give the network adapter time to reconnect before Tailscale logs in again.
Start-Sleep -Seconds 15
$compose = @('compose', '-f', 'docker-compose.prod.yml', '-f', 'docker-compose.home.yml')
docker @compose up -d *>> $log
docker @compose restart tailscale *>> $log
Log "Done (exit $LASTEXITCODE)"
