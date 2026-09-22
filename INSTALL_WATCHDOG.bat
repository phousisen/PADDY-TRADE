@echo off
REM PaddyTrade scale watchdog - installer
REM Right-click this file and choose "Run as administrator".
setlocal
set "DEST=C:\PaddyTrade\PING_PONG"

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Please close this window, right-click INSTALL_WATCHDOG.bat
  echo  and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)

if not exist "%DEST%\start.bat" (
  echo.
  echo  Could not find %DEST%\start.bat
  echo  Is the scale program installed in a different folder? Tell SISEN.
  echo.
  pause
  exit /b 1
)

copy /y "%~dp0scale_watchdog.ps1" "%DEST%\scale_watchdog.ps1" >nul
copy /y "%~dp0CHECK_SCALE.bat" "%DEST%\CHECK_SCALE.bat" >nul

schtasks /end /tn "PaddyTrade Scale Watchdog" >nul 2>&1
schtasks /create /tn "PaddyTrade Scale Watchdog" /tr "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%DEST%\scale_watchdog.ps1\"" /sc onstart /ru SYSTEM /rl HIGHEST /f
schtasks /run /tn "PaddyTrade Scale Watchdog"

echo.
echo  Done. The watchdog now runs in the background, also after every restart.
echo  It restarts the scale program by itself if the scale stops sending.
echo  To see what it has done: double-click CHECK_SCALE.bat in %DEST%
echo.
pause
