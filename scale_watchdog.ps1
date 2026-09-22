# PaddyTrade scale watchdog  -  22 Sept 2026
#
# Watches this PC's scale program. If the scale stops sending readings
# ("Scale not connected" in the app), it restarts the scale program by
# itself, so nobody has to restart the PC.
#
# It only READS http://127.0.0.1:8787/weight and restarts the program.
# It never touches tickets, the relay queue or the station login.

$ErrorActionPreference = "SilentlyContinue"
$Folder   = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartBat = Join-Path $Folder "start.bat"
$LogFile  = Join-Path $Folder "watchdog.log"
$TaskName = "PaddyTrade Weighbridge"
$Url      = "http://127.0.0.1:8787/weight"

$CheckEverySec  = 10     # look at the scale every 10 seconds
$BadChecksToAct = 3      # restart after 3 bad checks in a row (about 30 s)
$StaleAfterSec  = 60     # a reading older than this counts as "no readings"
$GraceAfterSec  = 60     # after a restart, give it a minute before judging again

function Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $LogFile -Value $line
  # keep the log small
  if ((Get-Item $LogFile).Length -gt 500KB) {
    $keep = Get-Content $LogFile -Tail 2000
    Set-Content -Path $LogFile -Value $keep
  }
}

function Test-Scale {
  try {
    $r = Invoke-RestMethod -Uri $Url -TimeoutSec 5
  } catch {
    return "scale program not answering"
  }
  if ($r.scale_connected -eq $false) { return "scale_connected is false" }
  if ($r.updated_at) {
    try {
      $age = ((Get-Date).ToUniversalTime() - ([DateTime]::Parse($r.updated_at)).ToUniversalTime()).TotalSeconds
      if ($age -gt $StaleAfterSec) { return ("last reading {0:N0} s old" -f $age) }
    } catch { }
  }
  return $null   # healthy
}

function Restart-ScaleProgram($why) {
  Log "RESTART  ($why)"
  schtasks /end /tn $TaskName 2>$null | Out-Null
  Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 4
  $task = schtasks /query /tn $TaskName 2>$null
  if ($LASTEXITCODE -eq 0 -and $task) {
    schtasks /run /tn $TaskName | Out-Null
    Log "         started again via the boot task"
  } elseif (Test-Path $StartBat) {
    Start-Process -FilePath $StartBat -WorkingDirectory $Folder -WindowStyle Minimized
    Log "         started again via start.bat"
  } else {
    Log "         could not find the boot task or start.bat in $Folder"
  }
}

Log "watchdog started in $Folder"
$bad = 0
Start-Sleep -Seconds 30   # let the scale program start first after boot
while ($true) {
  $problem = Test-Scale
  if ($problem) {
    $bad++
    if ($bad -eq 1) { Log "problem: $problem" }
    if ($bad -ge $BadChecksToAct) {
      Restart-ScaleProgram $problem
      $bad = 0
      Start-Sleep -Seconds $GraceAfterSec
      if (-not (Test-Scale)) { Log "         OK - scale is back" }
      continue
    }
  } else {
    if ($bad -gt 0) { Log "recovered by itself" }
    $bad = 0
  }
  Start-Sleep -Seconds $CheckEverySec
}
