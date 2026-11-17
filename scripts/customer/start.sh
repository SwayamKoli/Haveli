#!/usr/bin/env bash
# Starts Haveli. On first start it runs the setup. Stop it with Ctrl+C.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is not installed. Install the "LTS" version from https://nodejs.org and run this again.'
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=20?0:1)'; then
  echo 'The Node.js on this computer is too old. Install the current "LTS" version from https://nodejs.org'
  exit 1
fi
[ -f .env ] || node setup.mjs
[ -f .env ] || { echo 'Setup was not finished. Run this again to retry.'; exit 1; }
exec node server.mjs --open
