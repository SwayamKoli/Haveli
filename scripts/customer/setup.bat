@echo off
setlocal
cd /d "%~dp0"
title Haveli setup
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this computer.
  echo Install the "LTS" version from https://nodejs.org and then double-click this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node setup.mjs
echo.
pause
