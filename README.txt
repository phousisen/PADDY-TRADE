PING PONG - SCALE WATCHDOG (22 Sept 2026)

What it does
  If the scale stops sending readings ("Scale not connected" in the app),
  this restarts the scale program by itself within about 30 seconds.
  Nobody has to restart the PC any more. It does not touch tickets,
  the relay queue or the station login.

Install on the PING PONG PC (2 minutes)
  1. Copy this whole folder to the PING PONG PC (USB stick or download).
  2. Right-click INSTALL_WATCHDOG.bat  ->  "Run as administrator".
  3. It says "Done". That's all.

Check it
  Double-click C:\PaddyTrade\PING_PONG\CHECK_SCALE.bat
  It shows the scale reading now, and every restart the watchdog made.

Remove it
  Right-click UNINSTALL_WATCHDOG.bat  ->  "Run as administrator".

Also do once on that PC (stops the drop-outs happening at all)
  - Device Manager -> Ports -> Prolific USB-to-Serial (COM5) -> Properties
    -> Power Management -> untick "Allow the computer to turn off this device".
  - Power Options -> Change plan settings -> Advanced -> USB settings
    -> USB selective suspend -> Disabled.
  - Plug the scale's USB adapter into a port at the BACK of the PC.
