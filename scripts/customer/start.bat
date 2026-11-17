@echo off
setlocal
cd /d "%~dp0"
title Haveli
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this computer.
  echo Install the "LTS" version from https://nodejs.org and then double-click this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0])>=20?0:1)"
if errorlevel 1 (
  echo The Node.js on this computer is too old. Install the current "LTS" version from https://nodejs.org
  start "" https://nodejs.org
  pause
  exit /b 1
)
if not exist ".env" (
  echo First start: setting up Haveli...
  node setup.mjs
)
if not exist ".env" (
  echo Setup was not finished. Double-click start.bat again to retry.
  pause
  exit /b 1
)
node server.mjs --open
echo.
echo Haveli has stopped. If this was not on purpose, read the message above, then double-click start.bat again.
pause
