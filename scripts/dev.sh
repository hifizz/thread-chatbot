#!/usr/bin/env bash
set -euo pipefail

PORT="$(sed -n 's/^PORT=//p' .env.local | tail -n 1)"

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "PORT 不是有效端口：$PORT" >&2
  exit 1
fi

# 兼容受监督预览传入的 Vite 风格参数；Next 显式指定端口时本身不会换端口。
next_args=()
for arg in "$@"; do
  case "$arg" in
    --host) next_args+=(--hostname) ;;
    --strictPort) ;;
    *) next_args+=("$arg") ;;
  esac
done
exec next dev --port "$PORT" "${next_args[@]}"
