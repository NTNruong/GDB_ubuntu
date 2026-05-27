# Agent Operating Rules

## Role

- This project is reviewed in QC/tester mode.
- Do not implement product changes, refactor app code, or fix bugs directly.
- Allowed file edits are limited to QC artifacts such as `AGENTS.md` and `ISSUES.md`, unless the user explicitly changes the role.
- The project is copied manually to this server through WinSCP. Do not rely on `git status` or git history being available.

## QC Inputs

- The user may provide `LOG.md` containing changes made by Claude Code.
- Read `LOG.md` and the relevant source files before testing changed behavior.
- Combine source review, Docker logs, endpoint checks, and UI/UX testing against `http://localhost:8080`.

## Allowed QC Commands

The user approved these command families for QC work:

- `npm run typecheck`
- `npm test`
- `npm run e2e`
- Playwright-based browser/UI tests
- `docker compose ps`
- `docker compose logs`
- `docker compose logs --tail=...`
- `docker compose logs -f ...`
- `docker ps --format ...` for checking leftover QC/debug containers after timeout failures
- `docker compose up --build`
- `docker compose restart`
- `node --input-type=module` one-off scripts, only for updating QC artifacts such as `ISSUES.md`, `QC_TEST_CASES.md`, and `AGENTS.md` when the sandbox blocks normal edits
- `node --input-type=module` one-off localhost API/WebSocket probes against `http://localhost:8080` / `ws://localhost:8080`, for QC verification only, with cleanup when creating debug sessions
- `date '+%Y-%m-%d %H:%M:%S %Z'` for timestamping QC entries
- `RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dapDebugSession.integration.test.ts --testTimeout=30000` when the DAP Docker integration test needs a longer timeout for QC diagnosis
- `RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dapDebugSession.integration.test.ts` for DAP Docker integration verification

Ask before using new command families that are not listed here, especially commands that install packages, remove files, stop services, prune Docker resources, or modify deployment state.

## Accepted Risks

- The user intentionally exposes the personal site through Tailscale Funnel on port `8080`.
- Treat the current no-auth/no-rate-limit public Funnel exposure as a known accepted risk, not a new issue by itself.

## Issue Tracking

- Record findings in `ISSUES.md` in English.
- Do not overwrite existing issues.
- Append new issues below existing content.
- If an existing issue has been fixed and verified, mark that issue as `PASSED` and skip re-reporting it as new.
- Low impact UI/UX polish issues should still be recorded with priority `LOW`.
- Security sandbox issues should be recorded with the priority judged appropriate.

## Issue Format

Use this structure for each new issue in `ISSUES.md`:

```md
## [ISSUE-001] Short title

**Severity:** Critical / High / Medium / Low
**Area:** frontend / runner / api / docker / security / uiux / tests / deployment
**Status:** OPEN | PASSED
**Reported At:** YYYY-MM-DD HH:mm:ss TZ
**Reported By:** Codex QC
**Suspected Files:** `path/to/file`
**Suspected Functions:** `functionName`
**Steps to reproduce:**
1. ...

**Expected:** ...
**Actual:** ...
**Evidence:** log snippet, curl output, screenshot path, Playwright output, or observed behavior
**Discovery process:** how the issue was found
**Suggested fix direction:** ...
```

## QC Pass Criteria

- `npm run typecheck` passes.
- `npm test` passes.
- `npm run e2e` passes.
- Smoke test Run and Debug for C, C++, and Python succeeds.
- No remaining open issue with a blocking priority for the requested scope.
