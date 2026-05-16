# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tailnet-only online code runner (C `gnu17`, C++ `gnu++20`, Python 3.12) with DAP-based debugging. No login, no DB, no server-side source persistence — source/stdin/argv are explicitly redacted from logs. Designed to be exposed only inside a tailnet; do not put behind the public internet without adding auth and rate limiting.

## Commands

```bash
npm install
npm run dev          # builds @internal/shared, then runs api + runner + frontend concurrently
npm run build        # builds shared → api → runner → frontend (order matters)
npm run typecheck    # also aliased as `npm run lint`
npm test             # vitest, excludes tests/e2e
npm run test:watch
npm run e2e          # playwright against http://localhost:5173 by default
```

Run a single vitest file: `npm test -- apps/runner/src/dapClient.test.ts`

Docker-backed integration tests are gated behind `RUN_DOCKER_TESTS=1` and require the runner images to already exist:

```bash
docker compose --profile runner-images build runner-cpp-image runner-python-image
RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dockerRunner.integration.test.ts
RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dapDebugSession.integration.test.ts
```

Dev ports: frontend `5173` (Vite, proxies `/api` → `4000`), api `4000`, runner `4001`. Production compose maps frontend to `8080`.

Server deploy helper (on an Ubuntu host with the repo at `/opt/apps/GDB_ubuntu`): `bash bin/pull-latest.sh`. Flags: `RESTART_APP=1`, `REBUILD_RUNNER_IMAGES=1`.

## Architecture

Three-process npm workspace. Browser ⇄ **api** (Fastify, port 4000) ⇄ **runner** (Fastify, port 4001) ⇄ **Docker** (sibling containers per job).

- [packages/shared/src/index.ts](packages/shared/src/index.ts) is the source of truth for the wire protocol: `RunRequestSchema`, `DebugRequestSchema`, `DebugCommandSchema`, `RunEvent`, `DebugEvent`, plus size/arg limits and `LANGUAGE_CAPABILITIES`. Any protocol change starts here; `@internal/shared` must be rebuilt before dependents see new types — that's why every script (`build`, `dev`, `test`, `typecheck`) runs `npm run -w @internal/shared build` first.
- [apps/api/src/app.ts](apps/api/src/app.ts) is a thin proxy: validates with the shared zod schemas, forwards REST to the runner, and bidirectionally bridges client WebSockets to runner WebSockets (`/api/run/:id`, `/api/debug/:id`). It also re-streams the runner's SSE event stream at `/api/run/:id/events`.
- [apps/runner/src/app.ts](apps/runner/src/app.ts) owns job state (`activeJobs`, `runJobs`, `debugSessions`, `debugByClient`) and enforces `maxConcurrentJobs` plus one-debug-session-per-`clientId`. Events flow through [eventBuffer.ts](apps/runner/src/eventBuffer.ts), which replays history to late subscribers — that's why an SSE reconnect or WS late-attach still sees the full job timeline.
- [apps/frontend/src/App.tsx](apps/frontend/src/App.tsx) is a single-component Monaco-based UI; `@monaco-editor/react` + lucide icons. Breakpoint gutter logic is in [breakpoints.ts](apps/frontend/src/breakpoints.ts).

### Runner execution model

The runner process itself runs in a container but spawns **sibling** containers via the mounted docker socket. This makes workspace paths the most error-prone part of the codebase:

- `WORKSPACE_CONTAINER_ROOT` — path inside the runner container where it writes source files (e.g. `/runner-workspaces`).
- `WORKSPACE_HOST_ROOT` — the same directory as the host sees it (e.g. `/tmp/gdb-ubuntu-runner-workspaces`), used in the `Binds:` of child containers since the docker daemon resolves bind sources on the host. [workspace.ts](apps/runner/src/workspace.ts) does this translation; both paths must point to the same directory mounted into the runner via `docker-compose.yml`.

Child containers are locked down: `NetworkDisabled`, `CapDrop: ["ALL"]`, `ReadonlyRootfs`, `no-new-privileges`, `PidsLimit: 128`, memory + nano-cpus limits, tmpfs `/tmp`, no auto-remove (we wait + inspect for exit code). Output is capped at `MAX_OUTPUT_BYTES` (5 MiB) and the container is killed when exceeded; the `outputTruncated` flag flows back to the client.

Run vs debug containers use language-specific entrypoints baked into the runner images ([docker/runner-cpp/](docker/runner-cpp/), [docker/runner-python/](docker/runner-python/)): `run-c`, `run-cpp`, `run-python` for plain runs; `debug-c`/`debug-cpp` for GDB/MI; `debug-dap-c`/`debug-dap-cpp`/`debug-dap-python` for DAP. The runner image stdout/stderr is run through [phaseFilter.ts](apps/runner/src/phaseFilter.ts) which intercepts `__RUNNER_PHASE__:compile:start|done` / `:run:start` markers emitted by those scripts and turns them into `compile`/`run` events.

### Debug engines

Two implementations, selected per request:

- **DAP** (default, all languages) — [dapDebugSession.ts](apps/runner/src/dapDebugSession.ts) + [dapClient.ts](apps/runner/src/dapClient.ts). Speaks the Debug Adapter Protocol to `gdb -i dap` (C/C++) or `debugpy` (Python).
- **MI** (C/C++ only, fallback) — [debugSession.ts](apps/runner/src/debugSession.ts) + [gdbMi.ts](apps/runner/src/gdbMi.ts). Speaks GDB/MI directly. Selected only when `DEBUG_ENGINE=mi` **and** language ≠ python; see the ternary in [apps/runner/src/app.ts:98](apps/runner/src/app.ts#L98).

Both expose the same `DebugSessionLike` shape (`id`, `events`, `start`, `handleCommand`, `close`) so the routing layer doesn't care which one is in use. When changing one, check whether the other needs the matching change — they implement the same `DebugCommandSchema`.

### Key environment variables

Runner: `CPP_IMAGE`, `PYTHON_IMAGE`, `MAX_CONCURRENT_JOBS`, `RUN_TIMEOUT_MS`, `DEBUG_MAX_MS`, `DEBUG_IDLE_MS`, `DEBUG_ENGINE` (`dap`|`mi`), `MEMORY_BYTES`, `NANO_CPUS`, `DOCKER_SOCKET_PATH`, `WORKSPACE_CONTAINER_ROOT`, `WORKSPACE_HOST_ROOT`. Defaults are in [apps/runner/src/config.ts](apps/runner/src/config.ts).

API: `RUNNER_BASE_URL` (HTTP) and `RUNNER_WS_URL` (WebSocket) must point at the same runner instance.

## Conventions to be aware of

- TypeScript strict + `noUncheckedIndexedAccess` (see [tsconfig.base.json](tsconfig.base.json)). Array/Record indexing returns `T | undefined`; handle it.
- ESM-only (`"type": "module"`); use `.js` import specifiers for TS source.
- Fastify loggers in both services redact `req.body.source`, `req.body.stdin`, `req.body.argv` — preserve this when adding new endpoints that take user code.
- The runner image build is a separate `runner-images` compose profile so `docker compose up` of the app services doesn't unnecessarily rebuild them. After editing anything in [docker/runner-cpp/](docker/runner-cpp/) or [docker/runner-python/](docker/runner-python/), explicitly rebuild with `--profile runner-images`.
