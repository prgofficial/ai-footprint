#!/bin/sh
# AI Footprint — start here.
#
# All the real logic lives in scripts/init.mjs so it is testable and identical on every
# platform. This wrapper only checks that Node is present and hands over.

set -e

DIR=$(cd "$(dirname "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  printf '\n  AI Footprint needs Node.js 20 or newer.\n\n'
  printf '    Install it from https://nodejs.org/en/download\n'
  printf '    then run this command again:  sh init.sh\n\n'
  exit 1
fi

MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 20 ]; then
  printf '\n  AI Footprint needs Node.js 20 or newer (found %s).\n\n' "$(node -v)"
  printf '    Install a supported version from https://nodejs.org/en/download\n\n'
  exit 1
fi

exec node "$DIR/scripts/init.mjs" "$@"
