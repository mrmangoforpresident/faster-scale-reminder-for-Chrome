@echo off
title FASTER Check-in uninstaller
echo Removing FASTER Check-in. Your check-in history is kept.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
echo.
pause
