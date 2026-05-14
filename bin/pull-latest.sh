#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/apps/GDB_ubuntu}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
RESTART_APP="${RESTART_APP:-0}"
REBUILD_RUNNER_IMAGES="${REBUILD_RUNNER_IMAGES:-0}"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "Repository not found at: $APP_DIR" >&2
  echo "Set APP_DIR=/path/to/GDB_ubuntu if your repo lives elsewhere." >&2
  exit 1
fi

cd "$APP_DIR"

echo "Updating $APP_DIR from $REMOTE/$BRANCH..."
git fetch "$REMOTE" "$BRANCH"
git pull --ff-only "$REMOTE" "$BRANCH"

if [ "$REBUILD_RUNNER_IMAGES" = "1" ]; then
  echo "Rebuilding runner images..."
  docker compose --profile runner-images build runner-cpp-image runner-python-image
fi

if [ "$RESTART_APP" = "1" ]; then
  echo "Rebuilding and restarting app services..."
  docker compose up --build -d frontend api runner
fi

echo "Done."
