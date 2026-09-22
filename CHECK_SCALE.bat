@echo off
REM Shows the scale's current reading and the last things the watchdog did.
echo.
echo  ===== Scale right now =====
powershell -NoProfile -Command "try { Invoke-RestMethod http://127.0.0.1:8787/weight -TimeoutSec 5 | Format-List location_id,scale_connected,weight_kg,updated_at } catch { Write-Host '  The scale program is NOT answering.' }"
echo  ===== Watchdog, last 15 lines =====
if exist "%~dp0watchdog.log" (powershell -NoProfile -Command "Get-Content '%~dp0watchdog.log' -Tail 15") else (echo   no log yet)
echo.
pause
