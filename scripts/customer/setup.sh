#!/usr/bin/env bash
# Asks a few questions and writes the .env settings file.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is not installed. Install the "LTS" version from https://nodejs.org and run this again.'
  exit 1
fi
exec node setup.mjs "$@"
