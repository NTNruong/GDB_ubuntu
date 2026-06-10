# tests/qc/explorer.md — Accounts + file explorer checklist (Phase 2)

Scope: app-managed accounts and the per-user file explorer — login, tree CRUD, save, run-the-folder, isolation, and that anonymous run/debug is unchanged. See [`INDEX.md`](INDEX.md) for the field template/conventions.

Pre-req (one-time, server): seed a user with the admin CLI —
`docker compose exec api node apps/api/dist/cli/users.js add qcuser 'qc-pass'`.

---

## Section AUTH — Login / session (TC-EXP-001 → 004)

### TC-EXP-001 — Sign in succeeds
- **Steps**: Click **Sign in** → enter `qcuser` / `qc-pass` → submit.
- **Expected**: Dialog closes, topbar shows the username + a left **Explorer** sidebar rooted at `/home/qcuser`.
- **Pass**: [ ] sidebar visible [ ] no console errors

### TC-EXP-002 — Wrong password
- **Steps**: Sign in with a wrong password.
- **Expected**: Inline error "Invalid username or password"; no cookie set.
- **Pass**: [ ] error shown [ ] still logged out

### TC-EXP-003 — Login lockout
- **Steps**: Submit a wrong password 5×, then the correct one.
- **Expected**: 6th attempt is rejected with a "Too many attempts" message (HTTP 429) for ~30s.
- **Pass**: [ ] lockout triggers

### TC-EXP-004 — Session survives reload + logout
- **Steps**: After login, hard-reload (Ctrl+Shift+R). Then click the username to **sign out**.
- **Expected**: Reload stays logged in (cookie); sign-out hides the sidebar and drops server tabs, leaving a scratch buffer.
- **Pass**: [ ] persists on reload [ ] clean logout
- **Note**: requires a stable `SESSION_SECRET`; with an ephemeral secret a restart logs everyone out (expected).

---

## Section CRUD — Tree operations (TC-EXP-010 → 016)

### TC-EXP-010 — Create file + folder
- **Steps**: Use the sidebar **New file** / **New folder** buttons; create `main.c` and a folder `algos`, then a file `algos/util.c`.
- **Expected**: Entries appear; clicking a file opens it in a tab (basename label), language auto-selected by extension.
- **Pass**: [ ] nested create works [ ] tab opens

### TC-EXP-011 — Edit + Ctrl+S
- **Steps**: Edit an opened server file; observe the dirty dot on the tab; press **Ctrl+S**.
- **Expected**: Dirty dot clears; reopening the file shows the saved content.
- **Pass**: [ ] dirty indicator [ ] save persists

### TC-EXP-012 — Rename (same dir)
- **Steps**: Right-click a file in the sidebar → Rename → new name.
- **Expected**: Tree + any open tab update to the new name.
- **Pass**: [ ] rename reflected

### TC-EXP-013 — Recursive delete
- **Steps**: Right-click `algos` → Delete → confirm.
- **Expected**: Folder and its children vanish from the tree; open tabs under it close.
- **Pass**: [ ] recursive delete

### TC-EXP-014 — Path-safety (negative)
- **Steps**: (API-level, optional) `GET /api/files/content?path=../../etc/passwd` while logged in.
- **Expected**: HTTP 400, no file contents.
- **Pass**: [ ] traversal rejected

### TC-EXP-015 — Per-user isolation
- **Steps**: Seed a 2nd user, log in as them in a separate browser/profile.
- **Expected**: Their tree is empty / shows only their own files — never the first user's.
- **Pass**: [ ] homes isolated

---

## Section RUN-FOLDER — Run the whole folder (TC-EXP-020 → 024)

### TC-EXP-020 — C multi-file folder
- **Steps**: In one folder create `main.c` (calls a function), `util.c` (defines it), `util.h`. Open `main.c`, click **Run**.
- **Expected**: All three are gathered; program compiles + runs; output correct.
- **Pass**: [ ] folder compiled together

### TC-EXP-021 — Python needs main.py
- **Steps**: Folder with only `helper.py`, open it, Run.
- **Expected**: Friendly error "Python runs main.py — add a main.py to this folder." Add `main.py`, Run again → success.
- **Pass**: [ ] error then success

### TC-EXP-022 — Limits surfaced
- **Steps**: Put >20 source files (or >2 MB total) in one folder, Run.
- **Expected**: Friendly "max 20 files" / size message instead of a raw 400.
- **Pass**: [ ] limit message

### TC-EXP-023 — Debug a folder file
- **Steps**: Set a breakpoint in a server `.c`/`.py`, Debug.
- **Expected**: Session starts, stops at the breakpoint (breakpoints remapped to basenames).
- **Pass**: [ ] breakpoint hit

---

## Section REGRESS — Anonymous unchanged (TC-EXP-030)

### TC-EXP-030 — Anonymous run/debug
- **Steps**: Logged out, run C/C++/Python and a debug session as before.
- **Expected**: Identical to pre-Phase-2 behavior; no Explorer, single-buffer Python (no tab bar), all selectors intact.
- **Pass**: [ ] no regression
