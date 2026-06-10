# Phase 2 Roadmap — From MVP to a real online IDE

Phase 1 delivered a **stateless, trusted-environment** code runner + visual debugger for C, C++, and Python (see [README.md](README.md)). Phase 2 turns it into a **real multi-user online IDE**: accounts, persistent files/folders, multi-file projects, and sharing/collaboration.

> Issues for Phase 2 are opened starting at **ISSUE-040** (tracked in the internal `ISSUES.md`).

## ⚠ Architectural shift — read first

Phase 2 **reverses several Phase-1 invariants**: no-login, no database, no server-side source persistence, metadata-only logging. Introducing accounts and per-user stored code **changes the threat model fundamentally**. Therefore:

- **Every Phase-2 feature requires a fresh security review before it ships.**
- The **"no authentication" disclaimer in the README must be updated** once auth lands.
- New attack surface (auth, stored user code, sharing) must be threat-modeled per feature.

## Design discipline

Before implementing any new UI/UX feature (Auth, File Tree, Editor Tabs, Collaboration), the Designer (Antigravity IDE) **updates the corresponding spec in [DESIGN.md](DESIGN.md) first** — tokens, components, layout — so new components follow the existing grid / color / glass system.

## Scope (v1)

> **Shipped (v1):** Scope **1 (Accounts + Auth)** and **2 (File/Folder persistence)** landed as app-managed accounts (bcrypt `users.json`, signed-cookie sessions, admin-seeded CLI — no DB) plus a VSCode-like left sidebar explorer over per-user `USER_HOMES_ROOT/<username>` (full CRUD + Ctrl+S save). The **UI half of Scope 3 (Editor Tabs + run-the-folder)** is wired: a logged-in run/debug gathers every top-level file of the active file's folder into the existing multi-file pipeline. Backend stays app-managed (no database) and the runner is unchanged — user dirs are **not** mounted into child containers in v1. The required security review was exercised against the new auth + stored-code + path surface. Remaining: Scope 3's deeper project model and Scope 4 (sharing/collaboration).

### 1. Accounts + Authentication
- **Goal:** registration, login, sessions.
- **Backend:** user store (database), password + session security, auth middleware on the API.
- **UI/UX:** premium glassmorphic login/register modal, focus-consistent input fields, a user avatar menu in the header (`.topbar`), loading/skeleton states.
- **Note:** this is the keystone — get auth right before persistence and sharing build on top of it.

### 2. File / Folder persistence
- **Goal:** save user workspaces, directory trees, and source per account (reverses Phase-1 "no server-side source persistence").
- **Backend:** per-user storage with isolation and quotas.
- **UI/UX:** a Left Sidebar **file tree** (create / rename / delete / move), and persistence of open state across sessions.

### 3. Multi-file projects
- **Goal:** compile / run / debug projects with multiple source files, not just a single buffer.
- **Backend:** multi-source build + a project model.
- **UI/UX:** **Editor Tabs** above the Monaco editor to switch between open files; tied into the file tree.

### 4. Sharing / Collaboration
- **Goal:** share a project with view/edit permissions; optionally real-time co-editing.
- **Backend:** share tokens + permissions; for real-time, a sync layer (CRDT/OT) + presence service.
- **UI/UX:** a share modal (view/edit perms); presence indicators — online-user avatars in the header, and live cursors with name labels inside the editor.

## Suggested ordering

**Auth → persistence → multi-file → sharing/collaboration.** Each builds on the previous; sharing/collaboration is the largest and comes last.

---

_Internal-only planning (deploy specifics, detailed threat analysis) lives in `PHASE2.internal.md` (gitignored), not in this public roadmap._
