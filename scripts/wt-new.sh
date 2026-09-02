#!/usr/bin/env bash
set -euo pipefail

if (( $# < 1 || $# > 2 )); then
  echo "Usage: $0 <new-branch> [start-point]" >&2
  exit 1
fi

BRANCH="$1"
START_POINT="${2:-HEAD}"
SAFE_BRANCH="$(printf '%s' "$BRANCH" | tr '/' '-' | tr -cd 'a-zA-Z0-9-_')"

GIT_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
ROOT_DIR="$(dirname "$GIT_COMMON_DIR")"
WT_DIR="${ROOT_DIR}/${SAFE_BRANCH}"
REGISTRY="${GIT_COMMON_DIR}/wt-meta/registry.json"
ENV_SOURCE="${ROOT_DIR}/.env.local"
DB_NAME="wt_${SAFE_BRANCH}"

mkdir -p "$(dirname "$REGISTRY")"
[[ -f "$REGISTRY" ]] || printf '{}\n' > "$REGISTRY"

git worktree add -b "$BRANCH" "$WT_DIR" "$START_POINT"
cp "$ENV_SOURCE" "$WT_DIR/.env.local"
chmod 600 "$WT_DIR/.env.local"

PORT=4041
while node -e '
  const fs = require("node:fs");
  const registry = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const port = Number(process.argv[2]);
  const used = Object.values(registry).some((entry) => entry.port === port);
  process.exit(used ? 0 : 1);
' "$REGISTRY" "$PORT" || lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

node - "$WT_DIR/.env.local" "$PORT" "$DB_NAME" "$SAFE_BRANCH" <<'NODE'
const fs = require("node:fs")

const [envPath, port, databaseName, safeBranch] = process.argv.slice(2)
const original = fs.readFileSync(envPath, "utf8")
const databaseLine = original
  .split(/\r?\n/)
  .find((line) => line.startsWith("DATABASE_URL="))

if (!databaseLine) throw new Error("共享 .env.local 缺少 DATABASE_URL")

let databaseUrl = databaseLine.slice("DATABASE_URL=".length).trim()
if (
  (databaseUrl.startsWith('"') && databaseUrl.endsWith('"')) ||
  (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))
) {
  databaseUrl = databaseUrl.slice(1, -1)
}

const url = new URL(databaseUrl)
url.pathname = `/${databaseName}`

const updates = new Map([
  ["PORT", port],
  ["DATABASE_URL", url.toString()],
  ["BETTER_AUTH_URL", `http://localhost:${port}`],
  ["BETTER_AUTH_COOKIE_PREFIX", `thread-chat-${safeBranch}`],
])

const output = []
for (const line of original.split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)
  const key = match?.[1]
  if (key && updates.has(key)) {
    output.push(`${key}=${updates.get(key)}`)
    updates.delete(key)
  } else {
    output.push(line)
  }
}

if (output.at(-1) === "") output.pop()
if (updates.size > 0) output.push("")
for (const [key, value] of updates) output.push(`${key}=${value}`)

fs.writeFileSync(envPath, `${output.join("\n")}\n`, { mode: 0o600 })
NODE

docker exec -i thread-chat-pg createdb -U postgres "$DB_NAME"
docker exec -i thread-chat-pg psql -U postgres -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 \
  -c 'create schema thread_chat; create schema extensions; create extension vector with schema extensions'

cd "$WT_DIR"
pnpm install --frozen-lockfile
pnpm db:push
pnpm worktree:seed

node - "$REGISTRY" "$SAFE_BRANCH" "$PORT" "$DB_NAME" <<'NODE'
const fs = require("node:fs")

const [registryPath, key, port, databaseName] = process.argv.slice(2)
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"))
registry[key] = { port: Number(port), env: "local", dbName: databaseName }
fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`)
NODE

echo "Worktree ready: $WT_DIR"
echo "Development URL: http://localhost:$PORT"
