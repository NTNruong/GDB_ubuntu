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

## Rootless Docker isolation (ISSUE-044)

The runner bind-mounts the Docker socket to spawn sibling containers, so whoever controls the runner controls that daemon. To keep a runner compromise from becoming **host root**, the production stack runs under a **rootless Docker daemon owned by a dedicated low-privilege service user** — a runner compromise is then capped to that unprivileged user, not the host.

**The service user must NOT be your personal login or any sudo-capable account.** Via the socket an attacker can bind-mount that user's home; if it has `sudo`/`docker`/`wheel` membership or SSH keys, they can escalate or pivot, defeating rootless entirely.

One-time host setup (run as the service user, e.g. `gdbrunner`):

1. Create `gdbrunner` — **not** in `sudo`/`docker`/`wheel`/`adm`, no `/etc/sudoers.d` entry, home with no secrets/SSH keys used elsewhere.
2. Give it subuid/subgid ranges and install rootless Docker: `dockerd-rootless-setuptool.sh install`.
3. `sudo loginctl enable-linger gdbrunner` so the daemon survives logout.
4. Ensure cgroup v2 delegation for `cpu cpuset io memory pids` (so child-container `Memory`/`NanoCpus`/`PidsLimit` keep working — see ISSUE-015).
5. Own the deploy tree (`/opt/apps/GDB_ubuntu`) and the workspace dir with `gdbrunner`.

Wire the stack to the rootless daemon (no code change — `DOCKER_SOCKET_PATH` stays `/var/run/docker.sock` inside the container; only the host bind-source changes):

- Set in the deploy environment / `.env` next to `docker-compose.yml`:
  - `DOCKER_HOST=unix:///run/user/<uid>/docker.sock` (so `docker compose` talks to the rootless daemon)
  - `DOCKER_SOCK_SOURCE=/run/user/<uid>/docker.sock` (host bind-source of the socket)
  - `WORKSPACE_HOST_ROOT=/home/gdbrunner/gdb-workspaces` if `/tmp` is not owned by `gdbrunner` (must match the `environment:` value and the bind in `docker-compose.yml`).
- Run the **self-hosted GitHub Actions runner as `gdbrunner`** so auto-deploy uses the rootless daemon. Residual risk: the CI runner credentials then live in `gdbrunner`'s home — readable by an attacker who compromised the runner, but still **cannot reach host root**.

After switching, verify the sandbox did not regress: child-container memory/cpu/pids limits still enforced (re-run the `tests/qc/runner.md` resource-limit cases), a Run for each language succeeds, and a DAP debug session (needs `CapAdd: SYS_PTRACE`) stops at a breakpoint.

## WinSCP

Used **only** for `LOG.md` and `ISSUES.md` (gitignored, never tracked) — copying them straight into `/opt/apps/GDB_ubuntu/` does not interfere with `git pull --ff-only`. Do **not** deploy source code via WinSCP — push to `main` instead, otherwise the server tree diverges from git and the next auto-deploy `pull --ff-only` may fail.

## Verify after a deploy

Check the Actions run is green, then `docker compose logs --tail=50 <service>` on the server to confirm a clean start, do a manual UI smoke for the specific behavior the change targets, and hard-reload (Ctrl+Shift+R) the browser if the frontend was rebuilt.

## LOG.md "Deploy status" block

Note that the change deploys automatically on push to `main`, and call out explicitly whether the runner-images rebuild is triggered (i.e. whether anything under `docker/runner-cpp/` or `docker/runner-python/` changed). Past entries in `LOG.md` are the canonical examples of the expected format.
