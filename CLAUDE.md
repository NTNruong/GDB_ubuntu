# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tailnet-only online code runner for **seven languages** — C (`gnu17`), C++ (`gnu++20`), Python 3.12, JavaScript (Node), Java (selectable JDK 17/21/25), Go, and Rust. Every language can **run**; **debugging** (DAP-based) is available for C/C++/Python/Go/Rust/Java — only JavaScript is run-only. (Java debug uses Eclipse JDT LS + Microsoft java-debug behind an in-container bridge; all other DAP languages use a lightweight gdb/debugpy/Delve adapter.) Multi-file projects are supported (per-language file extensions, a `files[]` array). Anonymous run/debug stays login-free and stateless — source/stdin/argv are redacted from logs and cleaned up per job. **Phase 2** adds optional **app-managed accounts** (bcrypt `users.json`, signed-cookie sessions; admin-seeded via the `users` CLI, no public self-registration) that unlock a VSCode-like **file explorer** over a per-user home directory (`USER_HOMES_ROOT/<username>`, full CRUD + Ctrl+S save + run-the-folder). Designed to be exposed only inside a tailnet; do not put behind the public internet without adding rate limiting (and a stable `SESSION_SECRET` + HTTPS for accounts).

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

### Deploy workflow (GitHub Actions auto-deploy)

Deploy = **commit and push to `main`**. A self-hosted GitHub Actions runner on the Ubuntu host (`/opt/apps/GDB_ubuntu`) runs [bin/pull-latest.sh](bin/pull-latest.sh) — `git pull --ff-only` → `docker compose up --build -d` for the app services. See [.github/workflows/deploy.yml](.github/workflows/deploy.yml).

**Rebuild rule (single source of truth):** the auto-deploy **always** rebuilds the whole `runner-images` profile (`--profile runner-images`) — `pull-latest.sh` defaults `REBUILD_RUNNER_IMAGES=1`. Docker layer cache makes unchanged images a no-op, so this is cheap; in exchange the runner images and the app's advertised capabilities are **always built from the same commit**, killing the git-diff/HEAD-advance race that once let the app advertise a capability before its runner image rebuilt (ISSUE-059). A runner-images build failure makes `set -e` abort before the app services come up (fail-safe). App services (`api` / `runner` / `frontend`) always rebuild on deploy.

**WinSCP** is used **only** for `LOG.md` / `ISSUES.md` (gitignored). Never deploy source via WinSCP — push to `main`, otherwise the server tree diverges from git and the next `pull --ff-only` may fail.

Full runbook (dir→service rebuild matrix, `pull-latest.sh` flags, manual SSH deploy, verify-after-deploy, command tables) → [docs/DEPLOY.md](docs/DEPLOY.md).

## Architecture

Three-process npm workspace. Browser ⇄ **api** (Fastify, port 4000) ⇄ **runner** (Fastify, port 4001) ⇄ **Docker** (sibling containers per job).

- [packages/shared/src/index.ts](packages/shared/src/index.ts) is the source of truth for the wire protocol: `RunRequestSchema`, `DebugRequestSchema`, `DebugCommandSchema`, `RunEvent`, `DebugEvent`, plus size/arg limits and `LANGUAGE_CAPABILITIES` (per-language `run`/`debug` flags + optional selectable toolchain `versions`, e.g. Java `17`/`21`/`25`). `LANGUAGE_EXTENSIONS` + `RESERVED_FILENAMES` gate multi-file projects; `resolveToolchainVersion` is the single fallback rule for an omitted/invalid `toolchainVersion` (the runner must not re-implement it). Any protocol change starts here; `@internal/shared` must be rebuilt before dependents see new types — that's why every script (`build`, `dev`, `test`, `typecheck`) runs `npm run -w @internal/shared build` first.
- [apps/api/src/app.ts](apps/api/src/app.ts) is mostly a thin proxy for run/debug: validates with the shared zod schemas, forwards REST to the runner, and bidirectionally bridges client WebSockets to runner WebSockets (`/api/run/:id`, `/api/debug/:id`). It also re-streams the runner's SSE event stream at `/api/run/:id/events`. **Phase 2** adds two locally-served plugins it registers: [auth.ts](apps/api/src/auth.ts) (`/api/auth/*`, cookie-JWT, [userStore.ts](apps/api/src/userStore.ts) bcrypt accounts + login lockout) and [files.ts](apps/api/src/files.ts) (`/api/files/*`, auth-gated per-user CRUD; path safety in [pathSafety.ts](apps/api/src/pathSafety.ts)). These are the only stateful endpoints — they read/write `USER_HOMES_ROOT`, never the runner.
- [apps/runner/src/app.ts](apps/runner/src/app.ts) owns job state (`activeJobs`, `runJobs`, `debugSessions`, `debugByClient`) and enforces `maxConcurrentJobs` plus one-debug-session-per-`clientId`. Events flow through [eventBuffer.ts](apps/runner/src/eventBuffer.ts), which replays history to late subscribers — that's why an SSE reconnect or WS late-attach still sees the full job timeline.
- [apps/frontend/src/App.tsx](apps/frontend/src/App.tsx) is a single-component Monaco-based UI; `@monaco-editor/react` + lucide icons. Breakpoint gutter logic is in [breakpoints.ts](apps/frontend/src/breakpoints.ts).

### Runner execution model

The runner process itself runs in a container but spawns **sibling** containers via the mounted docker socket. This makes workspace paths the most error-prone part of the codebase:

- `WORKSPACE_CONTAINER_ROOT` — path inside the runner container where it writes source files (e.g. `/runner-workspaces`).
- `WORKSPACE_HOST_ROOT` — the same directory as the host sees it (e.g. `/tmp/gdb-ubuntu-runner-workspaces`), used in the `Binds:` of child containers since the docker daemon resolves bind sources on the host. [workspace.ts](apps/runner/src/workspace.ts) does this translation; both paths must point to the same directory mounted into the runner via `docker-compose.yml`.

Child containers are locked down: `NetworkDisabled`, `CapDrop: ["ALL"]`, `ReadonlyRootfs`, `no-new-privileges`, `PidsLimit: 128`, memory + nano-cpus limits, tmpfs `/tmp`, no auto-remove (we wait + inspect for exit code). Output is capped at `MAX_OUTPUT_BYTES` (5 MiB) and the container is killed when exceeded; the `outputTruncated` flag flows back to the client.

Run vs debug containers use language-specific entrypoints baked into **six** runner images, one per language family ([docker/runner-cpp/](docker/runner-cpp/), [docker/runner-python/](docker/runner-python/), [docker/runner-javascript/](docker/runner-javascript/), [docker/runner-java/](docker/runner-java/), [docker/runner-go/](docker/runner-go/), [docker/runner-rust/](docker/runner-rust/)): `run-c`/`run-cpp`/`run-python`/`run-javascript`/`run-java`/`run-go`/`run-rust` for plain runs; `debug-c`/`debug-cpp` for GDB/MI; `debug-dap-c`/`debug-dap-cpp`/`debug-dap-python`/`debug-dap-go`/`debug-dap-rust`/`debug-dap-java` for DAP (Java's entrypoint boots jdt.ls + java-debug and bridges DAP over stdio via [jdtls_debug_bridge.py](docker/runner-java/jdtls_debug_bridge.py)). The runner image stdout/stderr is run through [phaseFilter.ts](apps/runner/src/phaseFilter.ts) which intercepts `__RUNNER_PHASE__:compile:start|done` / `:run:start` markers emitted by those scripts and turns them into `compile`/`run` events.

### Debug engines

Two implementations, selected per request (only for debug-capable languages — C/C++/Python/Go/Rust/Java; the route 400s a debug request for a `debug:false` language, i.e. JavaScript, before creating a session):

- **DAP** (default; the only engine for Python/Go/Rust/Java) — [dapDebugSession.ts](apps/runner/src/dapDebugSession.ts) + [dapClient.ts](apps/runner/src/dapClient.ts). Speaks the Debug Adapter Protocol to a per-language adapter: `gdb -i dap` (C/C++ **and Rust**), `debugpy` (Python), **Delve `dlv dap`** for Go (TCP-only → `socat` stdio bridge), or **Eclipse JDT LS + Microsoft java-debug** for Java (the `debug-dap-java` entrypoint boots jdt.ls, does an LSP `vscode.java.startDebugSession` handshake to get a DAP port, and relays it to stdio via [jdtls_debug_bridge.py](docker/runner-java/jdtls_debug_bridge.py)). Java debug containers also get a higher `PidsLimit` and a `JAVA_VERSION` env (two JVMs: jdt.ls under Java ≥21 + the debuggee under the selected JDK).
- **MI** (C/C++ only, fallback) — [debugSession.ts](apps/runner/src/debugSession.ts) + [gdbMi.ts](apps/runner/src/gdbMi.ts). Speaks GDB/MI directly. Selected only when `DEBUG_ENGINE=mi` **and** language is `c`/`cpp`; every other language uses DAP regardless. See the engine ternary in [apps/runner/src/app.ts](apps/runner/src/app.ts) (the `createDebugSession` selection in the `/debug` route).

Both expose the same `DebugSessionLike` shape (`id`, `events`, `start`, `handleCommand`, `close`) so the routing layer doesn't care which one is in use. When changing one, check whether the other needs the matching change — they implement the same `DebugCommandSchema`.

### AI Learning Assistant (Phase 3)

Login-gated AI chat for **learning** (not run/debug). Visible only when authenticated (backend `guard` + frontend `user` gate), so it is one of the stateful api-served features alongside auth/files. Plugin [apps/api/src/chat.ts](apps/api/src/chat.ts) mirrors [files.ts](apps/api/src/files.ts) (`/api/ai/*`, every route auth-gated via the same `app.authenticate` preHandler) and **streams tokens as SSE** using the same `reply.hijack()` + `reply.raw.writeHead("text/event-stream")` pattern as `/api/run/:id/events`. `POST /api/ai/chat` carries a body (message + code context) so the browser reads it via `fetch()` + `ReadableStream`, not `EventSource`.

- **Backends** ([apps/api/src/ai/backends/](apps/api/src/ai/), common "one shape, multiple impls" idea as `DebugSessionLike`): `llama` (local **llama.cpp Vulkan** server, OpenAI-compatible `/v1/chat/completions`) and `gemini` (Google AI Studio `:streamGenerateContent`, free tier: Gemini Flash + Gemma 4 26B/31B → `gemma-4-26b-a4b-it`/`gemma-4-31b-it`) both expose `streamChat(): AsyncGenerator<string>` (text tokens). **`antigravity`** (`antigravity-preview-05-2026`, the agentic Interactions API `POST /v1beta/interactions`) is now implemented as a third backend with a richer `streamAgent(): AsyncGenerator<AiStreamEvent, {interactionId,environmentId}>` — it isn't token-streaming, so the runner **creates with `background:true` + polls `GET /interactions/{id}`** ([antigravity.ts](apps/api/src/ai/backends/antigravity.ts)), diffs each snapshot, and emits answer `token`s plus tool/code/image `step` events (the agent's "artifacts"). It authenticates with the **same Google key** as `gemini` (so they unlock together in `enabledModels`), uses Google's **remote sandbox** (`environment:"remote"`, `code_execution`+`google_search`), continues multi-turn via `previous_interaction_id`/`environment_id` persisted on the thread, and is bounded by `ANTIGRAVITY_MAX_MS` + cancel-on-disconnect. Very limited free quota — labelled experimental in the UI.
- **Local model on the server GPU:** Gemma 4 E4B GGUF (Q4_K_M / UD-Q4_K_XL, ~3–5 GB) on the **RX580 8GB** via **Vulkan/RADV** (ROCm dropped Polaris/gfx803; Vulkan is the reliable path, fp32-only). The RX570 4GB (PCIe x4) is spare. llama.cpp runs on the **host** (no in-Docker GPU passthrough for v1); the api reaches it via `LLAMA_BASE_URL`. Power-capped ~85% TDP via host `rocm-smi` (host ops, documented in [docs/DEPLOY.md](docs/DEPLOY.md), not app code).
- **Two orthogonal selectors** drive the system prompt ([apps/api/src/ai/prompts.ts](apps/api/src/ai/prompts.ts)): *Skill* = WHAT to learn (`language_syntax` for the editor's current language / `topic_roadmap` for a career track like embedded firmware, fresher→senior) and *Workflow* = HOW it answers (`answer` / `study_plan` / `strict_teacher`). Prompts teach **Vietnamese-first with English technical-term glosses** (matches the operator's learning style). The selected model + current file + selection + last run output are attached as context (toggleable).
- **Persistence:** threads are per-user JSON under `AI_DATA_ROOT/<username>/` — a **separate root from `USER_HOMES_ROOT`** so chat history never appears in the file explorer ([walkTree](apps/api/src/pathSafety.ts) walks the whole home incl. dotfiles) and cannot be CRUD'd via `/api/files/*`. Reuses `resolveUserPath`/`assertSafePath` for thread-id safety.
- **Per-user API keys:** each user can save their own Google key via `/api/ai/key` (GET masked status / PUT / DELETE). Stored **AES-256-GCM encrypted** at `AI_DATA_ROOT/<user>/gemini-key.enc` ([keystore.ts](apps/api/src/ai/keystore.ts), key derived from `AI_KEY_SECRET`→`SESSION_SECRET`), never returned to the client (`••last4` only), redacted from logs. A user key **takes precedence** over the server `GEMINI_API_KEY`; `enabledModels(config, hasUserGeminiKey)` and the `/chat` route resolve the effective key per request.
- **Frontend:** [apps/frontend/src/aiApi.ts](apps/frontend/src/aiApi.ts) mirrors [filesApi.ts](apps/frontend/src/filesApi.ts) (+ `chatStream` with `onToken`/`onStep`/`onDone`/`onError`); [apps/frontend/src/AiPanel.tsx](apps/frontend/src/AiPanel.tsx) is a right sidebar (debug-panel styling) wired into [App.tsx](apps/frontend/src/App.tsx) behind `{user && aiOpen && …}`. For an `antigravity` turn it renders an "Agent activity" timeline (`AgentStepView`: code blocks + results, tool chips, images) above the answer bubble.

### Key environment variables

Runner: one image var per language — `CPP_IMAGE`, `PYTHON_IMAGE`, `JAVASCRIPT_IMAGE`, `JAVA_IMAGE`, `GO_IMAGE`, `RUST_IMAGE` — plus `MAX_CONCURRENT_JOBS`, `RUN_TIMEOUT_MS`, `DEBUG_MAX_MS`, `DEBUG_IDLE_MS`, `DEBUG_ENGINE` (`dap`|`mi`), `MEMORY_BYTES`, `NANO_CPUS`, `DOCKER_SOCKET_PATH`, `WORKSPACE_CONTAINER_ROOT`, `WORKSPACE_HOST_ROOT`. Defaults are in [apps/runner/src/config.ts](apps/runner/src/config.ts).

API: `RUNNER_BASE_URL` (HTTP) and `RUNNER_WS_URL` (WebSocket) must point at the same runner instance. Accounts/explorer (Phase 2): `USER_HOMES_ROOT` (per-user homes dir, host bind via `USER_HOMES_HOST_ROOT` in compose), `USERS_FILE` (defaults to `<USER_HOMES_ROOT>/users.json`), `SESSION_SECRET` (cookie signing — unset = ephemeral, sessions reset on restart), `SESSION_COOKIE_SECURE` (`1` to mark the cookie `Secure`). AI assistant (Phase 3): `AI_ENABLED` (`0` disables the local-llama backend), `LLAMA_BASE_URL` (host llama.cpp server, default `http://localhost:8000`; under rootless Docker `host.docker.internal` is unreachable → use the host's tailnet/LAN address), `LLAMA_API_KEY` (bearer token matching llama-server `--api-key`, so the model port can't be called without it), `GEMINI_API_KEY` (optional server-wide fallback; per-user keys take precedence), `AI_DATA_ROOT` (per-user chat threads **and** encrypted API keys, separate from `USER_HOMES_ROOT`), `AI_KEY_SECRET` (AES key for per-user API keys at rest; defaults to `SESSION_SECRET`), `ANTIGRAVITY_MAX_MS` (wall-clock cap on one Antigravity agent run before stop+cancel, default `180000`). Defaults in [apps/api/src/config.ts](apps/api/src/config.ts).

## Windows development environment

Dev on Windows uses Docker Desktop with the WSL2 backend. Run all commands (`npm install`, `npm run dev`, etc.) from a WSL2 terminal — not PowerShell or CMD. No config changes needed; paths like `/var/run/docker.sock` and `/tmp/...` work normally inside WSL2.

## Multi-Agent Dev Relay Workflow

How the human operator, Claude Code, Antigravity IDE, and Codex QC collaborate on this repo. Engage this workflow when the user relays QC/Antigravity feedback, asks to "review / verify / check lại kết quả của QC", or asks to plan/implement an OPEN issue. Codex's mirror of this lives in the (gitignored) `AGENTS.md`.

### Roles

- **Human user** — operator/deployer. Relays reports between agents, pushes to `main`, runs deploys, and reports real manual-test observations. **The user always pushes; I never push to the remote.**
- **Claude Code (me)** — leader/developer. I implement product fixes, write the plan, record the `LOG.md` entry, and generate the commit message. I am the one that edits product source.
- **Antigravity IDE** — designer / UI-UX planner. Proposes or implements UI-UX-focused changes and records them in `LOG.md`.
- **Codex** — QC/tester. Reviews, verifies, tests, owns `ISSUES.md`, and writes QC entries in `LOG.md`. Codex does not implement product changes unless the user explicitly changes its role.

### Per-round workflow

When the user relays QC feedback, an Antigravity plan/summary, a design proposal/screenshot, a doc rewrite, or a manual bug report — treat it as a **hypothesis, with the codebase as ground truth**. Handle **one issue at a time, highest priority first**.

1. **Verify, don't trust.** Read the actual source/files/selectors behind the report and confirm the root cause in code *before* planning — never plan off the report alone. (After the ISSUE-030 wrong-fix, the user values verification/determinism highly.)
2. **Plan + structured assessment.** In plan mode, write the plan to the plan file and reach alignment before editing. Lead with a one-line verdict (phù hợp / cần sửa / không nên làm), then ✓ what matches vs ⚠❌ what is stale/wrong, each with a `file:line` citation.
3. **Implement by correcting, not copying.** On approval ("bạn hãy implement plan này nhé"), implement the change — and if the relayed plan carries a factual error (wrong mechanism, stale value, broken selector, an overclaim), fix it to match reality and call out the deviation explicitly; never propagate a known-wrong statement just because the plan said so.
4. **Verify locally:** `npm run typecheck && npm test && npm run build -w @internal/frontend` must be green. Re-check any e2e selectors the change touches (`.debug-toolbar`/`.debug-group`, `.var-row`/`.var-caret`, input placeholders / `data-testid`) so QC's post-deploy run stays green. (E2E needs a live server → QC verifies after deploy.)
5. **Record + close.** Add the top `LOG.md` entry and generate the commit message (see **Session workflow**). Close concisely: verified ✓ + what was corrected and why + the verification output + the exact next-step git commands for the user. Offer to commit; never commit/push unless asked.
6. **User pushes `main` manually** → GitHub Actions auto-deploys → QC verifies on the server and flips the issue to `PASSED` in `ISSUES.md`.

### Guardrails

- **Never push** the remote — the user always pushes manually. Never commit unless asked.
- **Deploy & rebuild:** push to `main` triggers the self-hosted runner; the runner-images rebuild rule → see **Deploy workflow**. State the deploy + rebuild status explicitly in every `LOG.md` "Deploy status".
- **Commit message:** single line, Conventional-Commits, ≤ 70 chars, no body, no `Co-Authored-By`, no `LOG.md`/`ISSUES.md` mention — see **Session workflow**.
- `LOG.md`, `ISSUES.md`, and `AGENTS.md` are **gitignored**; QC edits them via WinSCP on the server, so local copies may lag (line numbers differ) — **re-read before editing**.
- Preserve the Fastify log redaction of `req.body.files[*].content` / `stdin` / `argv` / `content` / `password`.

## Session workflow

After making code changes in any session, append a new entry at the **top** of `LOG.md` (newest first) before ending the session. The file is gitignored; it is the running record QC and human reviewers read to understand what changed between sessions.

Each entry follows the existing format — header `## YYYY-MM-DD — <Agent> (session N)`, then:

- **Agent:** Claude Code / Codex / Antigravity IDE / Human
- **Files Modified:** one bullet per file, with a short English note saying *what* changed and *which ISSUE-### it addresses* (if any)
- **Summary:** 2–4 sentences in English on root cause and fix direction (matching the existing tone)
- **Deploy status:** how it deploys (push to `main` auto-deploys) and whether the runner-images rebuild is triggered (rule → **Deploy workflow**)
- **Verification:** optional, but include when the fix has a non-trivial test/QC story

Increment the session number from the previous top entry. If a session only does research/reading without code edits, do not add an entry.

After writing the LOG.md entry (i.e. once implement → verify → LOG are done), also **generate the commit message content** for the session and present it to the user in the chat (do not commit/push unless the user asks). The user pushes manually.

- **Single line only.** Conventional-Commits style, ≤ 70 chars: `<type>(<scope>): <summary>` — e.g. `fix(runner): capture C/C++ debug stdout via workspace file (ISSUE-030)`. Common types: `feat`, `fix`, `refactor`, `chore`, `ci`, `docs`, `test`. No body, no bullets.
- Do **not** add the `Co-Authored-By` trailer or any `LOG.md`/`ISSUES.md` mention (both are gitignored — they are not part of the commit).

When an issue is fixed and verified, also update its status in `ISSUES.md` to `PASSED` (do not create duplicate entries — append `**Additional QC verification (timestamp):**` lines to the existing issue instead).

## Conventions to be aware of

- TypeScript strict + `noUncheckedIndexedAccess` (see [tsconfig.base.json](tsconfig.base.json)). Array/Record indexing returns `T | undefined`; handle it.
- ESM-only (`"type": "module"`); use `.js` import specifiers for TS source.
- Fastify loggers redact `req.body.files[*].content`, `req.body.stdin`, `req.body.argv` (run/debug source) plus `req.body.content` (explorer file writes) and `req.body.password` (login) — preserve this when adding new endpoints that take user code or credentials.
- The runner image build is a separate `runner-images` compose profile so `docker compose up` of the app services doesn't unnecessarily rebuild them (when/how to rebuild → **Deploy workflow**).
- **Language:** all tracked docs/trackers — `LOG.md`, `ISSUES.md`, `DESIGN.md`, `PHASE2.md`, READMEs (default), `tests/qc/` — are written in **English**. Chat replies to the user follow the global Vietnamese-first preference, but committed files stay English.
