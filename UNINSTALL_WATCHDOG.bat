@echo off
REM Removes the watchdog. Run as administrator. The scale program is not touched.
schtasks /end /tn "PaddyTrade Scale Watchdog" >nul 2>&1
schtasks /delete /tn "PaddyTrade Scale Watchdog" /f
echo Watchdog removed.
pause
