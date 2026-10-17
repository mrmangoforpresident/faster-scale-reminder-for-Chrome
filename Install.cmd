@echo off
title FASTER Check-in installer
echo Installing FASTER Check-in...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (echo. & echo Something went wrong - see the message above.)
echo.
pause
