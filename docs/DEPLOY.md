# Deploy runbook (agent-facing)

Operational detail for deploying GDB_ubuntu. `CLAUDE.md` keeps only the essentials (deploy = push to `main`; the runner-images rebuild rule); the rarely-needed mechanics live here and are read **on demand**. For the canonical build / run / log **command tables and flags**, see [README → 📦 Ubuntu / Tailscale Deployment](../README.md#-ubuntu--tailscale-deployment) — not duplicated here.

## How deploy happens

`commit → push main` → a self-hosted GitHub Actions runner on the Ubuntu 24.04 LTS host (`/opt/apps/GDB_ubuntu`) runs `bash bin/pull-latest.sh`: `git pull --ff-only` → `docker compose up --build -d` for the app services. The workflow ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml)) auto-detects `docker/` changes via `git diff HEAD origin/main` and sets `REBUILD_RUNNER_IMAGES=1` so the compiler base images rebuild before the app services restart.

`bin/pull-latest.sh` flags (for a rare manual SSH deploy): `RESTART_APP=1`, `REBUILD_RUNNER_IMAGES=1`. (Same table in README §Deployment.)

## What rebuilds when (dir → service)

- TypeScript / shared schema in `apps/runner/src/**` → rebuild `runner`
- TypeScript in `apps/api/src/**` → rebuild `api`
- Frontend (`apps/frontend/src/**`, `apps/frontend/index.html`, Vite config) → rebuild `frontend`
- Multiple of the above → `docker compose up --build -d` rebuilds all app services (what the auto-deploy always does via `RESTART_APP=1`)
- Anything under [docker/runner-cpp/](../docker/runner-cpp/) or [docker/runner-python/](../docker/runner-python/) (Dockerfile, `run-*`, `debug-*`, `debug-dap-*`) → **must also** run `docker compose --profile runner-images build runner-cpp-image runner-python-image` *before* `docker compose up --build -d` so child containers pick up the new image. The auto-deploy handles this when it detects `docker/` changes; if deploying by hand, skipping it is the most common mistake.
- `docker-compose.yml` env-var changes → `docker compose up -d` (no `--build` needed unless code also changed).

## WinSCP

Used **only** for `LOG.md` and `ISSUES.md` (gitignored, never tracked) — copying them straight into `/opt/apps/GDB_ubuntu/` does not interfere with `git pull --ff-only`. Do **not** deploy source code via WinSCP — push to `main` instead, otherwise the server tree diverges from git and the next auto-deploy `pull --ff-only` may fail.

## Verify after a deploy

Check the Actions run is green, then `docker compose logs --tail=50 <service>` on the server to confirm a clean start, do a manual UI smoke for the specific behavior the change targets, and hard-reload (Ctrl+Shift+R) the browser if the frontend was rebuilt.

## LOG.md "Deploy status" block

Note that the change deploys automatically on push to `main`, and call out explicitly whether the runner-images rebuild is triggered (i.e. whether anything under `docker/runner-cpp/` or `docker/runner-python/` changed). Past entries in `LOG.md` are the canonical examples of the expected format.
