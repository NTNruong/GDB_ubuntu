#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/apps/GDB_ubuntu}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
RESTART_APP="${RESTART_APP:-0}"
# Default to rebuilding runner images so manual/SSH deploys can't reintroduce the
# stale-image footgun the auto-deploy now avoids (ISSUE-059). Layer cache no-ops
# unchanged images; set REBUILD_RUNNER_IMAGES=0 to explicitly skip.
REBUILD_RUNNER_IMAGES="${REBUILD_RUNNER_IMAGES:-1}"

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
  # Build every service in the runner-images profile (cpp, python, javascript,
  # java, ...) so adding a language never needs a change here. Docker layer cache
  # makes unchanged images a no-op.
  docker compose --profile runner-images build
fi

if [ "$RESTART_APP" = "1" ]; then
  echo "Rebuilding and restarting app services..."
  docker compose up --build -d frontend api runner
fi

echo "Done."
