# Deploy runbook (agent-facing)

Operational detail for deploying GDB_ubuntu. `CLAUDE.md` keeps only the essentials (deploy = push to `main`; the runner-images rebuild rule); the rarely-needed mechanics live here and are read **on demand**. For the canonical build / run / log **command tables and flags**, see [README → 📦 Ubuntu / Tailscale Deployment](../README.md#-ubuntu--tailscale-deployment) — not duplicated here.

## How deploy happens

`commit → push main` → a self-hosted GitHub Actions runner on the Ubuntu 24.04 LTS host (`/opt/apps/GDB_ubuntu`) runs `bash bin/pull-latest.sh`: `git pull --ff-only` → `docker compose --profile runner-images build` (always) → `docker compose up --build -d` for the app services. The workflow ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml)) **always** sets `REBUILD_RUNNER_IMAGES=1`; `pull-latest.sh` also defaults it to `1`. This is deliberate: Docker layer cache no-ops unchanged images, and always rebuilding removes the old `git diff HEAD origin/main` race where a `git pull` advanced HEAD before the build, leaving the diff empty so the app advertised a new capability with a stale runner image (ISSUE-059). A runner-images build failure makes `set -e` abort before the app comes up (fail-safe).

`bin/pull-latest.sh` flags (for a rare manual SSH deploy): `RESTART_APP=1` (rebuild+restart app), `REBUILD_RUNNER_IMAGES=0` (opt **out** of the now-default image rebuild). (Same table in README §Deployment.)

## What rebuilds when (dir → service)

- TypeScript / shared schema in `apps/runner/src/**` → rebuild `runner`
- TypeScript in `apps/api/src/**` → rebuild `api`
- Frontend (`apps/frontend/src/**`, `apps/frontend/index.html`, Vite config) → rebuild `frontend`
- Multiple of the above → `docker compose up --build -d` rebuilds all app services (what the auto-deploy always does via `RESTART_APP=1`)
- Anything under any `docker/runner-*/` dir (Dockerfile, `run-*`, `debug-*`, `debug-dap-*`) → the runner image must rebuild *before* `docker compose up --build -d` so child containers pick up the new image. The auto-deploy **always** does this (`docker compose --profile runner-images build`, whole profile); manual SSH deploys rebuild by default too (`pull-latest.sh` defaults `REBUILD_RUNNER_IMAGES=1`), so the once-common "forgot to rebuild the image" mistake no longer applies unless you explicitly pass `REBUILD_RUNNER_IMAGES=0`.
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

## Accounts & file explorer

The optional per-user file explorer (Phase 2) is auth-gated and stores files on the host. One-time setup, run **as the `gdbrunner` service user** so the homes dir stays inside the ISSUE-044 rootless boundary:

1. Create the homes dir: `mkdir -p /home/gdbrunner/gdb-user-homes` (the api container writes here as `gdbrunner` under rootless Docker).
2. Add to the deploy `.env` (next to `docker-compose.yml`):
   - `USER_HOMES_HOST_ROOT=/home/gdbrunner/gdb-user-homes` — host bind-source (must match the `volumes:` entry and `USER_HOMES_ROOT=/user-homes` inside the container).
   - `SESSION_SECRET=$(openssl rand -hex 32)` — signs the auth cookie. **If unset the api logs a warning and uses an ephemeral secret, so every restart invalidates all sessions.** Set a stable value in production.
   - `SESSION_COOKIE_SECURE=1` once the stack is served over HTTPS (the cookie is `HttpOnly; SameSite=Lax` regardless).
3. `docker compose up -d` (env-only change → no `--build` unless code also changed), then seed the first user:
   ```bash
   docker compose exec api node apps/api/dist/cli/users.js add alice 's3cret'
   docker compose exec api node apps/api/dist/cli/users.js list
   ```
   The user's home dir is created automatically on first login.

`users.json` (default `<USER_HOMES_ROOT>/users.json`) and the per-user homes directory are the **only stateful host paths** the app owns — back them up together. There is no public self-registration; accounts are admin-managed via the CLI above.

## Public Funnel route allowlist (EXPLORER-001/002, ISSUE-049)

The container nginx (`apps/frontend/nginx.conf`) already proxies **all** of `/api/` to the api service, so login / Explorer / run / debug work on the LAN URL (`http://<host>:8080`). The **public Tailscale Funnel** is fronted by a **host** nginx (`/etc/nginx/conf.d/gdb_ubuntu.conf`, *not* in git): if it only allowlists the original run/debug routes, the Phase-2 account + file APIs return nginx `404` and **public login fails while LAN login works**.

Fix on the host (operator task — not deployable from the repo):

1. Ensure the Funnel `server {}` proxies every Phase-2 route. Simplest is a single catch-all that mirrors the container nginx:
   ```nginx
   # /etc/nginx/conf.d/gdb_ubuntu.conf  (inside the Funnel server block)
   client_max_body_size 8m;            # match MAX_REQUEST_BODY_BYTES (packages/shared)

   location /api/ {                    # covers /api/auth/*, /api/files/*, /api/run*,
     proxy_pass http://127.0.0.1:8080; # /api/debug*, /api/languages, /api/health
     proxy_http_version 1.1;
     proxy_set_header Host $host;
     proxy_set_header Upgrade $http_upgrade;        # websockets (debug, run ws)
     proxy_set_header Connection "upgrade";
     proxy_buffering off;                            # SSE run event stream
     proxy_read_timeout 1h;
     proxy_send_timeout 1h;
   }
   ```
   (If the host config must keep an explicit allowlist instead of a catch-all, add `location /api/auth/` and `location /api/files/` blocks alongside the existing ones.)
2. `sudo nginx -t && sudo systemctl reload nginx`.
3. Set `SESSION_COOKIE_SECURE=1` (see above) since the Funnel is HTTPS.

### Verification gate — do not consider the public route "done" until all pass on `https://<funnel-host>/`:

- Login succeeds; `GET /api/auth/me` returns the user; `GET /api/files/tree` returns the tree (not 404).
- Explorer create / read / write / rename / delete works.
- Run works **and** Stop cancels an infinite run with no orphan container/job (EXPLORER-005).
- Debug starts and stops at a breakpoint.
- The login / run / debug traffic appears in `docker compose logs api runner` of the **same** stack being tested, and `docker compose ps` shows **frontend + api + runner** (a stale/duplicate stack on `:8080` is ISSUE-046 — redeploy one clean stack from current source).

## WinSCP

Used **only** for `LOG.md` and `ISSUES.md` (gitignored, never tracked) — copying them straight into `/opt/apps/GDB_ubuntu/` does not interfere with `git pull --ff-only`. Do **not** deploy source code via WinSCP — push to `main` instead, otherwise the server tree diverges from git and the next auto-deploy `pull --ff-only` may fail.

## Verify after a deploy

Check the Actions run is green, then `docker compose logs --tail=50 <service>` on the server to confirm a clean start, do a manual UI smoke for the specific behavior the change targets, and hard-reload (Ctrl+Shift+R) the browser if the frontend was rebuilt.

## LOG.md "Deploy status" block

Note that the change deploys automatically on push to `main`. The runner-images rebuild now **always** runs (layer cache no-ops unchanged images), so a `docker/` change is no longer a prerequisite — just state that the relevant image rebuilds with the new content. Past entries in `LOG.md` are the canonical examples of the expected format.
