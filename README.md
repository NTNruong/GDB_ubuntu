# Internal Online Code Runner MVP

Tailnet-only code runner for C, C++, and Python with C/C++ GDB debugging.

## Features

- No login, no database, no server-side code persistence.
- C `gnu17`, C++ `gnu++20`, Python 3.12.
- C/C++ GDB debugger through a hybrid UI and raw GDB console.
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

## Verification

```bash
npm run typecheck
npm test
RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dockerRunner.integration.test.ts
npm run e2e
```
