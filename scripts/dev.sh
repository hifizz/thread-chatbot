#!/usr/bin/env bash
set -euo pipefail

PORT="$(sed -n 's/^PORT=//p' .env.local | tail -n 1)"

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "PORT 不是有效端口：$PORT" >&2
  exit 1
fi

exec next dev --port "$PORT" "$@"
