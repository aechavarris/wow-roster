# One-time setup on the home PC: registers a scheduled task that runs home-resume.ps1 every time
# Windows resumes from sleep (System log, Power-Troubleshooter event 1). Run it in PowerShell:
#   powershell -ExecutionPolicy Bypass -File C:\wow-roster-prod\deploy\register-resume-task.ps1
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'home-resume.ps1'
if (-not (Test-Path $script)) { throw "Missing $script (deploy once so the deploy job copies it)" }

$triggerClass = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace Root/Microsoft/Windows/TaskScheduler
$trigger = New-CimInstance -CimClass $triggerClass -ClientOnly
$trigger.Enabled = $true
$trigger.Subscription = @'
<QueryList><Query Id="0" Path="System"><Select Path="System">*[System[Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1]]</Select></Query></QueryList>
'@

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'wow-roster resume' -Description 'Reconnects the wow-roster stack after sleep' `
  -Trigger $trigger -Action $action -Settings $settings -Force | Out-Null
Write-Output "Registered 'wow-roster resume': runs $script after every resume from sleep."
