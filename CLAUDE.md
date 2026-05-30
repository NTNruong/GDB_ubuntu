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

### Deploy workflow (GitHub Actions auto-deploy)

Deployment is automated. A **GitHub Actions self-hosted runner** on the Ubuntu 24.04 LTS host (`/opt/apps/GDB_ubuntu`) watches `main`; every push to `main` triggers [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which runs `bash bin/pull-latest.sh` on the server. So the normal deploy is simply: **commit and push to `main`** — the runner does `git pull --ff-only`, then `docker compose up --build -d` for the app services. The workflow auto-detects changes under `docker/` (via `git diff HEAD origin/main`) and sets `REBUILD_RUNNER_IMAGES=1` so the compiler base images get rebuilt before the app services restart.

**WinSCP is used only for `LOG.md` and `ISSUES.md`.** Both are gitignored and never tracked, so copying them straight into `/opt/apps/GDB_ubuntu/` does not interfere with `git pull --ff-only`. Do **not** deploy source code via WinSCP — push to `main` instead, otherwise the server tree diverges from git and the next auto-deploy `pull --ff-only` may fail.

For understanding what the auto-deploy does (and for any rare manual SSH deploy), the rebuild rules are:
   - TypeScript / shared schema changes in `apps/runner/src/**` → rebuild `runner`
   - TypeScript changes in `apps/api/src/**` → rebuild `api`
   - Frontend (`apps/frontend/src/**`, `apps/frontend/index.html`, Vite config) → rebuild `frontend`
   - Multiple of the above → `docker compose up --build -d` rebuilds all app services (this is what the auto-deploy always does via `RESTART_APP=1`)
   - Anything under `docker/runner-cpp/` or `docker/runner-python/` (Dockerfile, run-*, debug-*, debug-dap-*) → **must also** run `docker compose --profile runner-images build runner-cpp-image runner-python-image` *before* `docker compose up --build -d` so child containers pick up the new image. The auto-deploy handles this automatically when it detects `docker/` changes; if deploying by hand, skipping it is the most common mistake.
   - `docker-compose.yml` env-var changes → `docker compose up -d` (no `--build` needed unless code also changed).

**Verify after a deploy:** check the Actions run is green, then `docker compose logs --tail=50 <service>` on the server to confirm a clean start, manual UI smoke for the specific behavior the change targets, and hard-reload (Ctrl+Shift+R) the browser if the frontend was rebuilt.

When writing the LOG.md entry for the session, the **Deploy status** block should note that the change deploys automatically on push to `main`, and call out explicitly whether the runner-images rebuild is triggered (i.e. whether anything under `docker/runner-cpp/` or `docker/runner-python/` changed). Past entries in LOG.md are the canonical examples of the expected format.

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

## Windows development environment

Dev on Windows uses Docker Desktop with the WSL2 backend. Run all commands (`npm install`, `npm run dev`, etc.) from a WSL2 terminal — not PowerShell or CMD. No config changes needed; paths like `/var/run/docker.sock` and `/tmp/...` work normally inside WSL2.

## Multi-Agent Dev Relay Workflow

How the human operator, Claude Code, Antigravity IDE, and Codex QC collaborate on this repo. Engage this workflow when the user relays QC/Antigravity feedback, asks to "review / verify / check lại kết quả của QC", or asks to plan/implement an OPEN issue. Codex's mirror of this lives in the (gitignored) `AGENTS.md`.

### Roles

- **Human user** — operator/deployer. Relays reports between agents, pushes to `main`, runs deploys, and reports real manual-test observations. **The user always pushes; I never push to the remote.**
- **Claude Code (me)** — leader/developer. I implement product fixes, write the plan, record the `LOG.md` entry, and generate the commit message. I am the one that edits product source.
- **Antigravity IDE** — designer / UI-UX planner. Proposes or implements UI-UX-focused changes and records them in `LOG.md`.
- **Codex** — QC/tester. Reviews, verifies, tests, owns `ISSUES.md`, and writes QC entries in `LOG.md`. Codex does not implement product changes unless the user explicitly changes its role.

### Per-round cadence

When the user relays QC feedback (or an Antigravity summary / manual bug report):

1. **Verify, don't trust.** Read the actual source behind every QC diagnosis and confirm the root cause in code *before* planning a fix — never plan off the report alone. (After the ISSUE-030 wrong-fix, the user values verification/determinism highly.)
2. **Plan first.** In plan mode, write the plan to the plan file and reach alignment before editing. Handle **one issue at a time, highest priority first**.
3. **User approves** (e.g. "bạn hãy implement plan này nhé") → implement the change.
4. **Verify locally:** `npm run typecheck && npm test && npm run build -w @internal/frontend` must be green. (E2E needs a live server → QC verifies after deploy.)
5. **Record:** add the top `LOG.md` entry and generate the commit message (see **Session workflow** for both formats).
6. **User pushes `main` manually** → GitHub Actions auto-deploys → QC verifies on the server and flips the issue to `PASSED` in `ISSUES.md`.

### Guardrails (mechanics live in the referenced sections)

- **Never push** the remote — the user always pushes manually. Never commit unless asked.
- **Deploy & rebuild rules:** push to `main` triggers the self-hosted runner (`bin/pull-latest.sh`). Runner-images rebuild **only** when something under [docker/runner-cpp/](docker/runner-cpp/) or [docker/runner-python/](docker/runner-python/) changed — see **Deploy workflow (GitHub Actions auto-deploy)** under Commands. State this explicitly in every `LOG.md` "Deploy status".
- **Commit message:** single line, Conventional-Commits, ≤ 70 chars, no body, no `Co-Authored-By`, no `LOG.md`/`ISSUES.md` mention — see **Session workflow**.
- `LOG.md`, `ISSUES.md`, and `AGENTS.md` are **gitignored**; QC edits them via WinSCP on the server, so local copies may lag (line numbers differ) — **re-read before editing**.
- Preserve the Fastify log redaction of `req.body.source` / `stdin` / `argv`.

## Session workflow

After making code changes in any session, append a new entry at the **top** of `LOG.md` (newest first) before ending the session. The file is gitignored; it is the running record QC and human reviewers read to understand what changed between sessions.

Each entry follows the existing format — header `## YYYY-MM-DD — <Agent> (session N)`, then:

- **Agent:** Claude Code / Codex / Antigravity IDE / Human
- **Files Modified:** one bullet per file, with a short Vietnamese/English note saying *what* changed and *which ISSUE-### it addresses* (if any)
- **Summary:** 2–4 sentences in Vietnamese on root cause and fix direction (matching the existing tone)
- **Deploy status:** which files need to be copied to the server and the exact `docker compose` command(s); note explicitly whether `--profile runner-images` rebuild is needed (yes if anything under [docker/runner-cpp/](docker/runner-cpp/) or [docker/runner-python/](docker/runner-python/) changed)
- **Verification:** optional, but include when the fix has a non-trivial test/QC story

Increment the session number from the previous top entry. If a session only does research/reading without code edits, do not add an entry.

After writing the LOG.md entry (i.e. once implement → verify → LOG are done), also **generate the commit message content** for the session and present it to the user in the chat (do not commit/push unless the user asks). The user pushes manually.

- **Single line only.** Conventional-Commits style, ≤ 70 chars: `<type>(<scope>): <summary>` — e.g. `fix(runner): capture C/C++ debug stdout via workspace file (ISSUE-030)`. Common types: `feat`, `fix`, `refactor`, `chore`, `ci`, `docs`, `test`. No body, no bullets.
- Do **not** add the `Co-Authored-By` trailer or any `LOG.md`/`ISSUES.md` mention (both are gitignored — they are not part of the commit).

When an issue is fixed and verified, also update its status in `ISSUES.md` to `PASSED` (do not create duplicate entries — append `**Additional QC verification (timestamp):**` lines to the existing issue instead).

## Conventions to be aware of

- TypeScript strict + `noUncheckedIndexedAccess` (see [tsconfig.base.json](tsconfig.base.json)). Array/Record indexing returns `T | undefined`; handle it.
- ESM-only (`"type": "module"`); use `.js` import specifiers for TS source.
- Fastify loggers in both services redact `req.body.source`, `req.body.stdin`, `req.body.argv` — preserve this when adding new endpoints that take user code.
- The runner image build is a separate `runner-images` compose profile so `docker compose up` of the app services doesn't unnecessarily rebuild them. After editing anything in [docker/runner-cpp/](docker/runner-cpp/) or [docker/runner-python/](docker/runner-python/), explicitly rebuild with `--profile runner-images`.
