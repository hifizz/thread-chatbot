#!/usr/bin/env bash

# Codex Local Environment setup script.
# New Git worktrees do not contain ignored files, so copy the development
# secrets from the primary checkout without ever printing their contents.

set -euo pipefail

worktree_root="$(git rev-parse --show-toplevel)"
git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
primary_checkout="$(dirname "$git_common_dir")"
source_env="${THREAD_CHAT_ENV_SOURCE:-$primary_checkout/.env.local}"
target_env="$worktree_root/.env.local"

if [[ ! -f "$target_env" ]]; then
  if [[ -f "$source_env" ]]; then
    cp "$source_env" "$target_env"
    chmod 600 "$target_env"
    echo "Copied .env.local from the primary checkout."
  else
    echo "No .env.local found at: $source_env" >&2
    echo "Set THREAD_CHAT_ENV_SOURCE to an explicit source file and rerun." >&2
    exit 1
  fi
else
  echo ".env.local already exists; leaving it unchanged."
fi

pnpm install --frozen-lockfile

echo "Worktree setup complete. Run migrations explicitly when needed: pnpm db:migrate"
