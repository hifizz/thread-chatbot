#!/usr/bin/env bash
set -euo pipefail

BRANCH="$1"
SAFE_BRANCH="$(printf '%s' "$BRANCH" | tr '/' '-' | tr -cd 'a-zA-Z0-9-_')"

GIT_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
ROOT_DIR="$(dirname "$GIT_COMMON_DIR")"
WT_DIR="${ROOT_DIR}/${SAFE_BRANCH}"
REGISTRY="${GIT_COMMON_DIR}/wt-meta/registry.json"

DB_NAME="$(node -e '
  const fs = require("node:fs");
  const registry = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const entry = registry[process.argv[2]];
  if (!entry) throw new Error(`注册表中没有 ${process.argv[2]}`);
  process.stdout.write(entry.dbName);
' "$REGISTRY" "$SAFE_BRANCH")"

git worktree remove "$WT_DIR"
docker exec -i thread-chat-pg dropdb -U postgres "$DB_NAME"

node - "$REGISTRY" "$SAFE_BRANCH" <<'NODE'
const fs = require("node:fs")

const [registryPath, key] = process.argv.slice(2)
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"))
delete registry[key]
fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`)
NODE

echo "Removed worktree: $WT_DIR"
echo "Removed database: $DB_NAME"
