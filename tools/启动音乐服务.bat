@echo off
rem ============================================================
rem  EPanel Music Server - quick start (no console window)
rem
rem  Double-click this file. Nothing will pop up.
rem  Look near the clock in the tray area for a music icon:
rem     right-click it -> copy address / open in browser /
rem                       open log / stop server
rem
rem  Music folder & port come from music_dir.txt and
rem  EPANEL_MUSIC_PORT (default 8000).
rem ============================================================
setlocal
set "PYW=D:\Python\Python313\pythonw.exe"
if not exist "%PYW%" set "PYW=pythonw.exe"
start "" "%PYW%" "%~dp0music_server.pyw" %*
endlocal
exit /b 0
