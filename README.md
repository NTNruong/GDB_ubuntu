# ⚡ Internal Online Code Runner MVP

<p align="center">
  <strong><img src="https://flagcdn.com/24x18/gb.png" width="20" alt="EN"> English</strong> &nbsp;·&nbsp; <a href="README.vi.md"><img src="https://flagcdn.com/24x18/vn.png" width="20" alt="VI"> Tiếng Việt</a>
</p>

A high-performance internal code runner with visual debugging for C, C++, and Python — built on the Debug Adapter Protocol (DAP) and isolated inside a secure Tailnet.

<p align="center">
  <img src="https://img.shields.io/badge/Tailnet-Isolated-10b981?style=for-the-badge&logo=tailscale&logoColor=white" alt="Tailnet Isolated" />
  <img src="https://img.shields.io/badge/DAP-Debugging-3b82f6?style=for-the-badge&logo=visual-studio-code&logoColor=white" alt="DAP Debugging" />
  <img src="https://img.shields.io/badge/Docker-Sandboxed-f59e0b?style=for-the-badge&logo=docker&logoColor=white" alt="Docker Sandboxed" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/C-gnu17-blue?style=flat-square" alt="C gnu17" />
  <img src="https://img.shields.io/badge/C%2B%2B-gnu%2B%2B20-blue?style=flat-square" alt="C++ gnu++20" />
  <img src="https://img.shields.io/badge/Python-3.12-blue?style=flat-square" alt="Python 3.12" />
</p>

---

## 🛠️ Feature Matrix & Security Boundary

The run-and-debug experience is built on strict security and performance principles:

| Feature | Description | Security marker |
|---|---|---|
| 🔒 **Ephemeral Run Jobs** | Anonymous run/debug keeps no database and no long-lived source: source/stdin/argv exist only transiently in each job's workspace, cleaned up after the job ends and redacted from logs. | **No DB · Ephemeral jobs** |
| 🗂️ **Accounts + File Explorer** | Optional app-managed accounts (bcrypt, cookie sessions) unlock a VSCode-like left sidebar over a per-user home directory (full CRUD, save, run-the-folder). Anonymous use is unchanged. | **App-managed auth · Per-user homes** |
| 🚀 **Multi-Language Runner** | Compiles and runs C `gnu17`, C++ `gnu++20`, and Python 3.12. | **GCC / Python 3.12** |
| 🔍 **DAP-Bridged Debugging** | Real-time interactive debugging via GDB (C/C++) and debugpy (Python), bridged straight into the Monaco editor over the Debug Adapter Protocol. | **GDB / debugpy / GDB-MI** |
| 🛡️ **Docker Sandbox Isolation** | Fully isolated execution: no outbound network access, with strict CPU, memory, run-time, and output limits. | **CapDrop / PidsLimit** |
| 👁️ **Metadata-Only Logging** | Privacy by default: only performance metadata is stored. Source, stdin, and output are dropped. | **No code/stdout stored** |

---

## 🔐 Security Model & Disclaimer

> [!WARNING]
> This tool **executes arbitrary code** (C/C++/Python). Each job runs in a hardened Docker sandbox (`NetworkDisabled`, `CapDrop: ALL`, `ReadonlyRootfs`, `no-new-privileges`, CPU/RAM/PID/time/output limits), but a sandbox only **mitigates** risk — it does not eliminate it.

* **Anonymous run is open; the file explorer requires an account.** Run/debug stay login-free and unthrottled — anyone who can reach the endpoint can run code. The per-user file explorer is gated behind app-managed accounts (bcrypt-hashed `users.json`, signed HttpOnly cookie sessions, a lightweight login lockout). There is **no public self-registration** — an admin seeds users with the [`users` CLI](docs/DEPLOY.md).
* **For trusted environments.** Designed to run **inside a private tailnet**. Do **not** place it directly on the public internet without adding your own rate limiting (reverse proxy / API gateway / Tailscale identity). Set a stable `SESSION_SECRET` and serve over HTTPS (`SESSION_COOKIE_SECURE=1`) before exposing accounts more widely.
* **Per-user storage isolation.** Each account's files live under its own subdirectory of `USER_HOMES_ROOT`; the API confines every path to that home (resolve + prefix assert + symlink rejection). Under the production rootless-Docker setup the files are owned by the unprivileged service user (ISSUE-044), so a runner compromise stays capped to that user.
* **Self-host at your own risk.** If you fork or deploy this, you are responsible for your own infrastructure security. The software is provided "AS IS", without warranty — see [LICENSE](LICENSE).
* **Log privacy.** Source / stdin / argv, explorer file `content`, and login `password` are redacted from logs; only performance metadata is kept.

---

## 📐 System Architecture

The execution flow of the system:

```mermaid
graph TD
    Client[Web Browser - Monaco Editor] <-->|HTTP / WebSockets| API[API Gateway :4000]
    API <-->|DAP / Exec Requests| Runner[Runner Service :4001]
    Runner <-->|Create / Manage| HostFS[(Host Shared Workspaces)]
    Runner <-->|Spawn Containers| Container[Docker Sandbox Container]
    Container <-->|Read / Write| HostFS
```

---

## 🚀 Local Development

Run the following on your local machine to start the full development environment:

```bash
npm install
npm run dev
```

* **Frontend:** `http://localhost:5173`
* **API:** `http://localhost:4000`
* **Runner:** `http://localhost:4001`

> [!IMPORTANT]
> Docker is required to build the runner images used as isolated sandboxes:
> ```bash
> docker compose --profile runner-images build runner-cpp-image runner-python-image
> ```

---

## 📦 Ubuntu / Tailscale Deployment

Production deployment on an Ubuntu host with Tailscale installed:

| Step | Command | Description |
|---|---|---|
| **1. Build Images** | `docker compose --profile runner-images build runner-cpp-image runner-python-image` | Build the isolated GCC/Python sandbox images. |
| **2. Run Services** | `docker compose up --build -d frontend api runner` | Start the app services in detached mode. |
| **3. Tailnet Access** | Expose `http://<tailscale-ip>:8080` | Tailnet only. Do not expose to the public internet without auth. |
| **4. Shared Space** | Mounts `/tmp/gdb-ubuntu-runner-workspaces` | Temporary file-exchange area for child containers. |

> [!IMPORTANT]
> The runner controls the Docker socket, so run the production stack under a **rootless Docker daemon owned by a dedicated, non-sudo service user** to keep a runner compromise from becoming host root. Set `DOCKER_HOST` / `DOCKER_SOCK_SOURCE` to the rootless socket — see the rootless runbook in [docs/DEPLOY.md](docs/DEPLOY.md#rootless-docker-isolation-issue-044).

### Accounts & file explorer

The optional per-user file explorer needs three things in the deploy `.env` (next to `docker-compose.yml`) and a seeded user. Full one-time setup → [docs/DEPLOY.md](docs/DEPLOY.md#accounts--file-explorer).

| Env var | Purpose | Production value |
|---|---|---|
| `SESSION_SECRET` | Signs the auth cookie. Unset → ephemeral secret, sessions reset on restart. | `openssl rand -hex 32` |
| `USER_HOMES_HOST_ROOT` | Host bind-source of the per-user homes (owned by the rootless service user). | `/home/gdbrunner/gdb-user-homes` |
| `SESSION_COOKIE_SECURE` | Set `1` to mark the cookie `Secure` (serve over HTTPS). | `1` behind TLS |

Seed accounts with the admin CLI (no public self-registration):

```bash
docker compose exec api node apps/api/dist/cli/users.js add alice 's3cret'
docker compose exec api node apps/api/dist/cli/users.js list
docker compose exec api node apps/api/dist/cli/users.js remove alice
```

`users.json` and the per-user homes directory are the only stateful host paths — back them up together.

---

## 🤖 Server Update Helper

Deployment auto-syncs on every push to `main` via a self-hosted GitHub Actions runner. The helper script can also be run manually:

| Update scenario | Command | Scope |
|---|---|---|
| **Code only** | `bash bin/pull-latest.sh` | Pull the latest code onto the host. |
| **Restart the app** | `RESTART_APP=1 bash bin/pull-latest.sh` | Rebuild & restart the app containers. |
| **Sandbox Dockerfile changed** | `REBUILD_RUNNER_IMAGES=1 RESTART_APP=1 bash bin/pull-latest.sh` | Rebuild the sandbox images + app. |

---

## 📊 Logs & Observability

Inspect service logs for debugging and monitoring:

### All services (follow)
```bash
docker compose logs -f frontend api runner
```

### A single service
```bash
docker compose logs -f runner  # or api / frontend
```

### HTTP traffic (Nginx access logs)
The `frontend` service is Nginx; its access log is written to the container's stdout, so it shows up in `docker compose logs`. Use these filters to view only real HTTP requests:

* **All HTTP access:**
  ```bash
  docker compose logs -f frontend | grep -E '"(GET|POST|PUT|DELETE|HEAD) '
  ```
* **Last 200 lines:**
  ```bash
  docker compose logs --tail=200 frontend | grep -E '"(GET|POST|PUT|DELETE|HEAD) '
  ```

---

## 🧪 Verification Suite

Run the integration test suite to confirm the system is stable before shipping:

```bash
npm run typecheck
npm test
RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dockerRunner.integration.test.ts
RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dapDebugSession.integration.test.ts
npm run e2e
```
