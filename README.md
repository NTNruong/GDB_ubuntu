# Internal Online Code Runner MVP

Tailnet-only code runner for C, C++, and Python with DAP-based debugging.

## Features

- No login, no database, no server-side code persistence.
- C `gnu17`, C++ `gnu++20`, Python 3.12.
- C/C++ debugging through GDB and Python debugging through debugpy, bridged to the editor via the Debug Adapter Protocol (DAP). C/C++ also has a GDB/MI engine as a fallback (`DEBUG_ENGINE=mi`).
- Docker-isolated execution with no network, CPU/RAM/time/output limits.
- Metadata-only logging. Source, stdin, and output are not logged.

## Local Development

```bash
npm install
npm run dev
```

The frontend runs on `http://localhost:5173`, API on `http://localhost:4000`, and runner on `http://localhost:4001`.

The runner requires Docker and the local execution images:

```bash
docker compose --profile runner-images build runner-cpp-image runner-python-image
```

## Ubuntu/Tailscale Deployment

Build runner images first, then start the app:

```bash
docker compose --profile runner-images build runner-cpp-image runner-python-image
docker compose up --build -d frontend api runner
```

Expose `http://<tailscale-ip>:8080` inside the tailnet. Do not publish this service to the public internet without adding authentication and rate limiting.

The runner uses `/tmp/gdb-ubuntu-runner-workspaces` on the Ubuntu host as a temporary shared workspace for Docker child containers. The compose file creates and mounts this path automatically.

## Server Update Helper

Deployment is automated: every push to `main` triggers a GitHub Actions
self-hosted runner on the Ubuntu host (`/opt/apps/GDB_ubuntu`), which runs
`bin/pull-latest.sh` to pull, rebuild, and restart the app services. The
commands below are that same helper, for a manual run.

After cloning the repo to `/opt/apps/GDB_ubuntu`, update code with:

```bash
bash bin/pull-latest.sh
```

To pull, rebuild, and restart app containers:

```bash
RESTART_APP=1 bash bin/pull-latest.sh
```

If runner image scripts or Dockerfiles changed:

```bash
REBUILD_RUNNER_IMAGES=1 RESTART_APP=1 bash bin/pull-latest.sh
```

## Logs

View logs for all running app services:

```bash
docker compose logs -f frontend api runner
```

View logs for a single service:

```bash
docker compose logs -f runner
docker compose logs -f api
docker compose logs -f frontend
```

Show recent logs without following:

```bash
docker compose logs --tail=200 runner
```

### Nginx access log

The `frontend` service is Nginx, and its access log is written to the
container's stdout, so it appears in the service logs:

```bash
docker compose logs -f frontend
```

To show only HTTP access lines (filtering out Nginx startup/config output):

```bash
docker compose logs frontend | grep -E '"(GET|POST|PUT|DELETE|HEAD) '
```

Combine with `--since` / `--tail` to scope the window, e.g. last 200 lines:

```bash
docker compose logs --tail=200 frontend | grep -E '"(GET|POST|PUT|DELETE|HEAD) '
```

## Verification

```bash
npm run typecheck
npm test
RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dockerRunner.integration.test.ts
RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dapDebugSession.integration.test.ts
npm run e2e
```
