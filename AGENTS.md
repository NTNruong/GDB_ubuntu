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

## Multi-Agent QC Relay Workflow

Use this project-local workflow when the user relays reports between the human operator, Claude Code, Antigravity IDE, and Codex QC.

### Fixed Roles

- Human user: operator/deployer. The user copies files manually, runs deploy/build commands, and reports real manual-test observations.
- Claude Code: leader/developer. Claude may implement product fixes and record source-change summaries in `LOG.md`.
- Antigravity IDE: designer/UI-UX planner. Antigravity may propose or implement UI/UX-focused changes and record them in `LOG.md`.
- Codex: QC/tester. Codex reviews, verifies, tests, and documents findings only; Codex does not implement product changes unless the user explicitly changes the role.

### Trigger Inputs

Start this workflow when the user provides any of these inputs:

- A Claude Code or Antigravity IDE summary.
- A new or updated `LOG.md`.
- A manual bug report, screenshot, browser observation, deploy note, or test result from the user.
- A request to verify, review, check, rerun test cases, or update `ISSUES.md`.

### Default QC Sequence

1. Read `LOG.md` first when it is relevant, then inspect the changed source files and existing `ISSUES.md` entries.
2. Cross-check the user report against source behavior before assuming the fix is correct.
3. Verify the deployed/runtime state with allowed commands such as `docker compose ps`, `docker compose logs`, endpoint probes, Playwright UI tests, and localhost WebSocket/API probes.
4. Run the appropriate test scope for the change: at minimum targeted reproduction; use `npm run typecheck`, `npm test`, and `npm run e2e` when the change affects build, shared logic, UI, runner behavior, or regression coverage.
5. Compare expected behavior, actual behavior, source evidence, test output, and user screenshots/reports.
6. Update `ISSUES.md`: mark fixed verified issues as `PASSED` and compact them after closure; append new issues in English when defects remain.
7. Update `LOG.md` with a concise Codex QC session entry describing files touched, summary, deploy status, and verification.
8. Reply to the user in Vietnamese with a concise summary of what was reviewed, what was tested, what changed in QC artifacts, and what remains open.

### Output Contract

- `ISSUES.md`: English only, issue-format compliant, durable enough for Claude Code to implement from it.
- `LOG.md`: English session entry preferred for agent readability; concise narrative with commands/results summarized, not raw full logs unless necessary.
- User-facing response: Vietnamese, concise, with clear PASS/FAIL status, important command results, changed files, and remaining open issues.
- If verification is incomplete, state exactly what was not run and why.

### Safety Boundaries

- Stay in QC/tester mode. Do not edit product source, refactor code, or fix bugs directly.
- Ask before using command families not already allowed in this file.
- Treat the user manual report as valid evidence, but still verify with source/runtime tests whenever feasible.
- Do not rely on git history or `git status` as authoritative because this server may receive files via manual WinSCP copy.


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


## Closed Issue Compaction Workflow

When an issue is fixed and verified:

- First update the issue status to `PASSED` and add the final QC verification note.
- Keep all `OPEN` issues in full detail. Do not compact open issues.
- Compact `PASSED` issues after closure to keep `ISSUES.md` readable.
- A compacted closed issue should retain: title, severity, area, status, reported metadata when known, suspected files, compact summary, final verification summary, and archive note.
- Add or keep a global `Compact Archive Caveat` in `ISSUES.md`: `LOG.md` is session-level narrative only, and fine-grained historical evidence from old issue bodies may not be retained after compaction.
- Do not claim that `LOG.md` contains detailed command output unless the exact evidence is actually present there.
- If a closed issue had important residual risk, keep that risk in the compact summary, for example "monitor if flaky behavior repeats".
- If an old issue regresses after compaction, create a follow-up issue or append a fresh Additional QC verification note with new evidence.

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
