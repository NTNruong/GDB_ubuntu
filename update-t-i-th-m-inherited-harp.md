# Review & Hardening Plan — GDB Ubuntu Online Runner

## Context

Người dùng đã thêm 2 feature mới (diagnostics parser + runtime metrics, commit `b60339c`) và **deploy public qua Tailscale Funnel** — phá vỡ assumption gốc "Tailnet-only, no auth" trong [CLAUDE.md](f:/GDB_ubuntu/CLAUDE.md).

Server hiện tại:
- Public internet reachable (qua Funnel) → bất kỳ ai cũng submit code được
- Không auth, không rate limit, không HTTPS termination ở nginx
- Home lab, disposable host, không có credential nhạy cảm
- **Triệu chứng:** debug C/C++ stuck ngay từ đầu, không bao giờ vào breakpoint

Mục tiêu plan: liệt kê toàn bộ vấn đề (security, sandbox escape, DoS, debug bug, code quality) + đề xuất fix có ưu tiên rõ ràng. Chưa viết code.

---

## Bảng tổng kết findings

| # | Severity | Khu vực | Vấn đề ngắn |
|---|---|---|---|
| 1 | **P0** | Debug | DAP debug C/C++ stuck — gdb DAP chiếm stdin/stdout chung với inferior |
| 2 | **P0** | DoS | Fastify không có `bodyLimit` → POST source/stdin GB-size → OOM |
| 3 | **P0** | DoS | `EventBuffer` không giới hạn → late subscriber + flood = unbounded memory |
| 4 | **P0** | Sandbox | Tmpfs `/exec` rw+exec dùng chung readonly rootfs → có chỗ ghi+exec |
| 5 | **P1** | Auth | Không rate limit per-IP, không CAPTCHA, không token throttle |
| 6 | **P1** | Auth | `clientId` do client gửi → ai cũng có thể chiếm slot debug duy nhất của người khác |
| 7 | **P1** | Auth | CORS `origin: true` ở api → bất kỳ web nào trên internet POST `/api/run` được |
| 8 | **P1** | DoS | `maxConcurrentJobs=6` global, không phân theo IP → 1 attacker chiếm hết |
| 9 | **P1** | DoS | Workspace `/tmp/gdb-ubuntu-runner-workspaces` không có disk quota — write 5MB output × N session = fill disk |
| 10 | **P1** | Sandbox | `SYS_PTRACE` ở debug container cộng với `no-new-privileges` không đủ chặn ptrace lung tung trong container |
| 11 | **P2** | Sandbox | Không có seccomp profile — `unshare`, `kexec_load`, `bpf`, `io_uring`, `keyctl` mở |
| 12 | **P2** | Sandbox | Docker socket mount = runner RCE → host RCE; nên chuyển rootless docker hoặc gVisor |
| 13 | **P2** | Sandbox | `argv` không có size limit; nhiều arg dài có thể ăn RAM/log |
| 14 | **P2** | Ops | Không có health check trong `docker-compose.yml` (chỉ endpoint `/health`, không probe) |
| 15 | **P2** | Ops | `bin/pull-latest.sh` không verify signed tag; `git pull --ff-only` chấp nhận bất kỳ commit nào trên branch |
| 16 | **P3** | Code | `gdbserver` vẫn install trong [docker/runner-cpp/Dockerfile:13](f:/GDB_ubuntu/docker/runner-cpp/Dockerfile#L13) dù path DAP không dùng |
| 17 | **P3** | Code | Race trong `initializeDap` — `configurationDone` gửi trước khi `launch` response trả về |
| 18 | **P3** | UX | `diagnostics.ts` regex chỉ bắt format GCC `file:line:col: severity: msg` — bỏ multi-line notes |
| 19 | **P3** | UX | Metric không emit khi compile fail; FE hiển thị "—" cho mọi phase chưa chạy |

---

## P0 — Phải fix ngay (prod broken hoặc trivially exploitable)

### 1. Debug C/C++ stuck — không bao giờ vào breakpoint

**File:** [docker/runner-cpp/debug-dap-c:12](f:/GDB_ubuntu/docker/runner-cpp/debug-dap-c#L12), [docker/runner-cpp/debug-dap-cpp:12](f:/GDB_ubuntu/docker/runner-cpp/debug-dap-cpp#L12), [apps/runner/src/dapDebugSession.ts:252-259](f:/GDB_ubuntu/apps/runner/src/dapDebugSession.ts#L252-L259)

**Phân tích:**
- gdb được exec với `gdb --interpreter=dap --quiet` — gdb DAP server đọc DAP messages từ **stdin**, ghi response/event ra **stdout**
- DAP launch arg cho C/C++ chỉ có `program`, `args`, `cwd`, không có cách định nghĩa inferior stdin/stdout
- Khi inferior chạy, nó kế thừa stdin/stdout của gdb → mọi input scanf đọc nhầm DAP frames; mọi `printf` của inferior bị trộn vào DAP stream → DAP client parser thấy non-Content-Length data → có thể fail silent hoặc hang
- Triệu chứng "stuck from start" có thể đến từ:
  - gdb DAP không emit `initialized` event (timeout 10s tại [dapDebugSession.ts:221](f:/GDB_ubuntu/apps/runner/src/dapDebugSession.ts#L221))
  - hoặc image trên server chưa rebuild sau commit `bb5a715` (server vẫn dùng image cũ với gdbserver) — file `bb5a715` đổi cả entrypoint
  - hoặc compile fail âm thầm, "compile:done" marker không bao giờ xuất hiện → `waitForDebugAdapterReady` timeout 30s

**Đề xuất fix (theo thứ tự thử):**

1. **Verify image trên server đã rebuild:**
   - SSH vào server, chạy `docker run --rm internal-code-runner-cpp:0.1.0 cat /usr/local/bin/debug-dap-c` → nội dung phải khớp với 12-line version (không có gdbserver)
   - Nếu chưa: `REBUILD_RUNNER_IMAGES=1 bash bin/pull-latest.sh`

2. **Capture log thực tế:**
   - Tạm thời bỏ `--quiet` trong [debug-dap-c:12](f:/GDB_ubuntu/docker/runner-cpp/debug-dap-c#L12) để xem gdb startup output
   - Thêm `docker logs <container>` vào error path của `start()` để dump stderr khi initialize timeout
   - Verify `gdb --version` ≥ 14 trên image (Ubuntu 24.04 ships gdb 15, OK — nhưng vẫn nên `RUN gdb --version` trong Dockerfile để fail-fast)

3. **Tách kênh I/O cho inferior (root cause):**
   - Cách 1: cấu hình DAP launch arg `console: "externalTerminal"` + handle `runInTerminal` request từ adapter — phức tạp, cần socat
   - Cách 2: dùng `gdb -ex "set inferior-tty /workspace/tty"` trong wrapper script và pipe stdin từ file qua named pipe — hợp với kiến trúc hiện tại
   - Cách 3 (đơn giản hơn): chuyển debug C/C++ về MI mode tạm thời (đặt `DEBUG_ENGINE=mi`) cho đến khi giải quyết DAP I/O — nhưng MI cũng có vấn đề tương tự (chưa redirect stdin)

4. **Sửa race trong DAP protocol sequence** ([dapDebugSession.ts:218-232](f:/GDB_ubuntu/apps/runner/src/dapDebugSession.ts#L218-L232)):
   - DAP spec: `initialize → response → emit "initialized" event → setBreakpoints → configurationDone → launch response`
   - Code hiện gửi `launch` trước, `configurationDone` trước khi launch response trả → một số DAP adapter (gdb) có thể không hài lòng
   - Sửa: chỉ gửi `launch` ở dạng `request: "launch"` trong attach arguments → đợi `initialized` event → setBreakpoints → configurationDone → đợi response của launch

### 2. Thiếu `bodyLimit` ở Fastify

**File:** [apps/api/src/app.ts:19](f:/GDB_ubuntu/apps/api/src/app.ts#L19), [apps/runner/src/app.ts:38](f:/GDB_ubuntu/apps/runner/src/app.ts#L38)

**Vấn đề:** Fastify mặc định bodyLimit 1MB, nhưng phía proxy api→runner dùng `fetch` với body JSON.stringify — nếu attacker gửi `stdin` 100MB, api buffer hết rồi mới reject hoặc forward → OOM.

**Fix:** `Fastify({ bodyLimit: 2_000_000, ... })` ở cả 2 service. Đồng thời thêm zod `.max()` vào `source`, `stdin`, `argv` trong [packages/shared/src/index.ts](f:/GDB_ubuntu/packages/shared/src/index.ts) (đã có limit thì verify cứng, chưa có thì thêm: source ≤ 256KB, stdin ≤ 1MB, argv ≤ 100 items × 4KB).

### 3. `EventBuffer` không giới hạn

**File:** [apps/runner/src/eventBuffer.ts](f:/GDB_ubuntu/apps/runner/src/eventBuffer.ts)

**Vấn đề:** Buffer replay cho late subscriber, không thấy có cap. Một job emit 10K event sẽ giữ trong RAM cho 5 phút (theo `setTimeout(... 5 * 60_000)` ở [app.ts:77](f:/GDB_ubuntu/apps/runner/src/app.ts#L77)) → fork bomb output gây OOM runner.

**Fix:** Giới hạn buffer ≤ 1000 events (drop oldest + emit `{type:"buffer-truncated"}`), hoặc tổng size ≤ 1MB.

### 4. Tmpfs `/exec` rw+exec

**File:** [apps/runner/src/dockerRunner.ts:97-100](f:/GDB_ubuntu/apps/runner/src/dockerRunner.ts#L97-L100), [apps/runner/src/dapDebugSession.ts:106-109](f:/GDB_ubuntu/apps/runner/src/dapDebugSession.ts#L106-L109)

**Vấn đề:** `ReadonlyRootfs: true` rất tốt, nhưng `/exec` là tmpfs rw+exec để chứa binary đã compile. Untrusted code đang chạy có thể write thêm file vào `/exec` và execve. Không break sandbox (vẫn `CapDrop: ALL`, `no-new-privileges`), nhưng mở chance chain với kernel exploit.

**Fix mềm:** giữ rw+exec nhưng đảm bảo size cap (đã có `size=64m`). Workspace `/workspace` rw+nosuid+nodev — nhưng bind mount, không có nosuid/nodev option ở [dockerRunner.ts:89](f:/GDB_ubuntu/apps/runner/src/dockerRunner.ts#L89) → kiểm lại docker version có set default.

**Fix cứng (nếu muốn):** chuyển compile output sang `/workspace/.exec/` (bind mount, có thể nosuid+nodev). Cần update tất cả entrypoint script.

---

## P1 — Abuse mitigations sau khi public Funnel

### 5. Rate limit per-IP

**File:** [apps/api/src/app.ts](f:/GDB_ubuntu/apps/api/src/app.ts)

**Fix:** Thêm `@fastify/rate-limit` ở api (vì api là proxy được Funnel attach vào — runner ở internal network). Đề xuất:
- 5 req/min cho `/api/run` và `/api/debug` per IP
- 60 req/min cho `/api/health` + `/api/languages`
- IP lấy từ header `X-Forwarded-For` (Funnel set), fallback `req.ip`

### 6. `clientId` server-generated

**File:** [apps/runner/src/app.ts:89](f:/GDB_ubuntu/apps/runner/src/app.ts#L89), [packages/shared/src/index.ts](f:/GDB_ubuntu/packages/shared/src/index.ts) `DebugRequestSchema`

**Vấn đề:** `clientId` lấy từ request body. Ai cũng có thể đoán/dùng cùng ID → người khác bị 409 hoặc bị kick. Đồng thời cho phép enumerate user khác.

**Fix:** Bỏ field `clientId` khỏi request schema. Runner tự generate session ID (đã có `session.id` = uuid). Nếu cần "1 debug per browser tab" thì FE giữ `sessionStorage` chứa session ID nhận về từ POST `/api/debug`, dùng lại nếu re-attach. Server-side rate limit per IP đảm nhiệm phần "chống abuse".

### 7. CORS quá rộng

**File:** [apps/api/src/app.ts:26-28](f:/GDB_ubuntu/apps/api/src/app.ts#L26-L28)

**Fix:** `origin: process.env.ALLOWED_ORIGIN ?? false` — chỉ cho frontend chính thức. Frontend Funnel URL vào env var. Nếu thực sự muốn public API, ít nhất chặn `credentials: false` (default đã false vì không có cookie).

### 8. `maxConcurrentJobs` global

**File:** [apps/runner/src/app.ts:65](f:/GDB_ubuntu/apps/runner/src/app.ts#L65), [apps/runner/src/config.ts:26](f:/GDB_ubuntu/apps/runner/src/config.ts#L26)

**Vấn đề:** Global 6 slot. 1 attacker với 6 connection chiếm hết.

**Fix:** Thêm map `activeJobsPerIP` (limit 1-2 per IP) trước khi check global. Cần truyền IP vào runner — đơn giản nhất: api forward header `X-Real-Client-IP` xuống runner.

### 9. Workspace disk quota

**File:** [apps/runner/src/workspace.ts](f:/GDB_ubuntu/apps/runner/src/workspace.ts), `docker-compose.yml`

**Vấn đề:** `/tmp/gdb-ubuntu-runner-workspaces` (mount vào runner) không có size limit. Mỗi job tạo dir, ghi source + stdin + scratch + tmp. Output 5MB cap đã có nhưng compile cache, tmp file của program không cap.

**Fix:**
- Mount workspace là **tmpfs** size 1GB ở docker-compose: `tmpfs: /tmp/gdb-ubuntu-runner-workspaces:size=1g`
- Hoặc thêm `du` check ở `dockerRunner.run()` finally trước khi rm — log nếu vượt 100MB
- Set `--storage-opt size=100M` cho child container (cần Docker với overlay2 + xfs quota — phức tạp, có thể skip nếu tmpfs đã đủ)

### 10. SYS_PTRACE quá rộng

**File:** [apps/runner/src/dapDebugSession.ts:99](f:/GDB_ubuntu/apps/runner/src/dapDebugSession.ts#L99), [apps/runner/src/debugSession.ts:60](f:/GDB_ubuntu/apps/runner/src/debugSession.ts#L60)

**Vấn đề:** SYS_PTRACE cho phép ptrace bất kỳ process nào trong container (cùng PID namespace). Nếu attacker compile + chạy program ptrace inferior khác trong cùng container thì có thể đọc memory — nhưng vì container fresh mỗi session, không có process khác → chỉ self-ptrace.

**Đánh giá:** rủi ro thấp với current isolation, nhưng vẫn nên giới hạn. SYS_PTRACE cần thiết để gdb attach.

**Fix nâng cao (optional):** thêm seccomp profile cho phép ptrace nhưng chặn các syscall escalation khác (xem #11).

---

## P2 — Defense in depth

### 11. Seccomp profile

**Hiện trạng:** không có `SecurityOpt: ["seccomp=..."]`. Docker default seccomp đang dùng — đã chặn nhiều thứ nhưng vẫn cho phép `clone(CLONE_NEWUSER)`, `unshare(CLONE_NEWUSER)` trên kernel mới.

**Fix:** Custom seccomp profile (extend Docker default) chặn thêm:
- `unshare`, `clone3` với `CLONE_NEWUSER`
- `kexec_load`, `kexec_file_load`
- `bpf` (trừ khi cần)
- `io_uring_setup`, `io_uring_enter`
- `userfaultfd`
- `perf_event_open`
- `keyctl`, `add_key`, `request_key`

Lưu profile thành file `docker/seccomp/runner.json`, mount vào runner container, pass cho child container qua `SecurityOpt`.

### 12. Docker socket → rootless / gVisor

**Hiện trạng:** [docker-compose.yml:44](f:/GDB_ubuntu/docker-compose.yml#L44) mount `/var/run/docker.sock`. Runner RCE = host RCE.

**Fix dài hạn:**
- **Rootless Docker:** chạy daemon thứ 2 không-root, mount socket đó. Cố gắng nhất.
- **gVisor (runsc runtime):** thêm `runtime: runsc` vào HostConfig của child container — bao bọc syscall, hiệu năng giảm 10-30% nhưng tăng cô lập rõ rệt.
- **Docker-in-Docker (DinD) trong rootless mode:** phức tạp, skip.

**Tạm thời:** verify host có nothing-important; document rõ trong README rằng public exposure giả định disposable host.

### 13. Argv/source size limits cứng

**File:** [packages/shared/src/index.ts](f:/GDB_ubuntu/packages/shared/src/index.ts) (verify hiện tại có `MAX_*` constants)

**Fix:** zod schema cứng:
```ts
source: z.string().max(256_000),
stdin: z.string().max(1_000_000),
argv: z.array(z.string().max(4096)).max(100),
breakpoints: z.array(z.number().int().min(1).max(100_000)).max(50),
```

### 14. Health check trong docker-compose

**Fix:** Thêm `healthcheck:` cho từng service trong docker-compose.yml:
```yaml
runner:
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://localhost:4001/health').then(r=>process.exit(r.ok?0:1))"]
    interval: 30s
    timeout: 5s
    retries: 3
```
Frontend dùng `wget` hoặc `curl`. API dùng tương tự runner.

### 15. `bin/pull-latest.sh` không verify

**Fix:** 
- Documented: chỉ chạy bởi user root duy nhất, từ shell trực tiếp (không CI auto-trigger từ webhook)
- Thêm step `git verify-tag $TAG` nếu có signed release tag — yêu cầu setup git tag signing
- Tối thiểu: log full commit SHA + author trước khi rebuild để có audit trail

---

## P3 — Code, ops, UX

### 16. Bỏ `gdbserver` khỏi image

**File:** [docker/runner-cpp/Dockerfile:13](f:/GDB_ubuntu/docker/runner-cpp/Dockerfile#L13)

**Fix:** Xoá dòng `gdbserver \`. Sau commit `bb5a715` path DAP không dùng. MI path cũng không dùng (xem [debug-c:12](f:/GDB_ubuntu/docker/runner-cpp/debug-c#L12) — gọi `gdb --args` trực tiếp).

### 17. Race trong DAP sequence

(xem chi tiết ở mục #1)

### 18. Diagnostics regex bỏ multi-line notes

**File:** [apps/frontend/src/diagnostics.ts](f:/GDB_ubuntu/apps/frontend/src/diagnostics.ts)

**Đề xuất:** Thêm test case cho:
- `note:` lines liên kết với error trước đó
- `In file included from ...:` headers
- `<source>:N:M:` format khi compile từ stdin (không xảy ra ở app này nhưng tốt cho future-proof)
- Multi-line message với `~~~~^~~~~` caret line (đã có "context lines" filter, verify đầy đủ)

### 19. Metric thiếu khi compile fail

**File:** [docker/runner-cpp/run-c:18](f:/GDB_ubuntu/docker/runner-cpp/run-c#L18), [apps/frontend/src/App.tsx](f:/GDB_ubuntu/apps/frontend/src/App.tsx) (chỗ render metric)

**Hiện trạng:** Metric chỉ emit khi `run` phase chạy. Khi compile fail, không có metric → FE hiển thị "—".

**Fix:** OK với hành vi hiện tại (đúng nghĩa "không có dữ liệu run"). Chỉ cần verify FE không crash khi metric undefined. Optional: thêm compile-phase metric (`/usr/bin/time gcc ...`) nếu user muốn xem compile cost.

---

## Verification plan

Sau khi implement fix, verify bằng:

1. **Debug feature (P0.1):**
   - Local: `RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dapDebugSession.integration.test.ts`
   - Manual: `npm run dev`, mở http://localhost:5173, paste code C với scanf + breakpoint, bấm Debug → phải dừng đúng breakpoint, input từ stdin panel phải tới được scanf
   - Production: SSH server, `docker compose logs runner -f`, trigger debug từ public URL, capture log; sau đó dùng `docker exec -it <runner-cpp-container> bash` để kiểm tra binary, gdb version

2. **Body limit / event buffer cap (P0.2, P0.3):**
   - Test: `curl -X POST .../api/run -d '{"source":"...10MB...","language":"c","stdin":"","argv":[]}'` → phải nhận 413, không crash
   - Test: code C `while(1) printf("X\n");` → phải bị kill sau 5MB (đã có) + EventBuffer không phình

3. **Rate limit + per-IP concurrency (P1.5, P1.8):**
   - Test: vòng for `curl` 10 lần `/api/run` → request 6+ nhận 429
   - Test: 2 IP khác nhau cùng submit → cả 2 đều chạy được

4. **Sandbox (P0.4, P1.10, P2.11):**
   - Test code C: `system("ls /")` → fail (PATH OK nhưng đọc rootfs readonly OK); `mount("...", ...)` → fail; `unshare(CLONE_NEWUSER)` → seccomp deny
   - Test code Python: `import socket; socket.socket(...)` → fail (network disabled)

5. **Diagnostics + metrics (P3.18, P3.19):**
   - Unit test: thêm GCC stderr samples vào [diagnostics.test.ts](f:/GDB_ubuntu/apps/frontend/src/diagnostics.test.ts)
   - Manual: code có warning + error → UI hiển thị đúng cả 2 với severity icon

---

## Critical files cần thay đổi (tổng hợp)

**Sandbox/Runner core:**
- [apps/runner/src/dockerRunner.ts](f:/GDB_ubuntu/apps/runner/src/dockerRunner.ts)
- [apps/runner/src/dapDebugSession.ts](f:/GDB_ubuntu/apps/runner/src/dapDebugSession.ts)
- [apps/runner/src/debugSession.ts](f:/GDB_ubuntu/apps/runner/src/debugSession.ts)
- [apps/runner/src/eventBuffer.ts](f:/GDB_ubuntu/apps/runner/src/eventBuffer.ts)
- [apps/runner/src/app.ts](f:/GDB_ubuntu/apps/runner/src/app.ts)
- [apps/runner/src/config.ts](f:/GDB_ubuntu/apps/runner/src/config.ts)

**API/proxy:**
- [apps/api/src/app.ts](f:/GDB_ubuntu/apps/api/src/app.ts)

**Shared protocol:**
- [packages/shared/src/index.ts](f:/GDB_ubuntu/packages/shared/src/index.ts)

**Docker images & entrypoints:**
- [docker/runner-cpp/Dockerfile](f:/GDB_ubuntu/docker/runner-cpp/Dockerfile)
- [docker/runner-cpp/debug-dap-c](f:/GDB_ubuntu/docker/runner-cpp/debug-dap-c)
- [docker/runner-cpp/debug-dap-cpp](f:/GDB_ubuntu/docker/runner-cpp/debug-dap-cpp)
- [docker/runner-cpp/debug-c](f:/GDB_ubuntu/docker/runner-cpp/debug-c), [debug-cpp](f:/GDB_ubuntu/docker/runner-cpp/debug-cpp)
- [docker/runner-python/debug-dap-python](f:/GDB_ubuntu/docker/runner-python/debug-dap-python)
- (mới) `docker/seccomp/runner.json`

**Compose & deploy:**
- [docker-compose.yml](f:/GDB_ubuntu/docker-compose.yml)
- [bin/pull-latest.sh](f:/GDB_ubuntu/bin/pull-latest.sh)
- [apps/frontend/nginx.conf](f:/GDB_ubuntu/apps/frontend/nginx.conf)

**Frontend (UX P3):**
- [apps/frontend/src/diagnostics.ts](f:/GDB_ubuntu/apps/frontend/src/diagnostics.ts)
- [apps/frontend/src/App.tsx](f:/GDB_ubuntu/apps/frontend/src/App.tsx)

**Docs:**
- [CLAUDE.md](f:/GDB_ubuntu/CLAUDE.md) — cập nhật phần đầu: "deployed via Tailscale Funnel, public", liệt kê assumption mới
- [README.md](f:/GDB_ubuntu/README.md)

---

## Đề xuất thứ tự thực hiện

**Phase A (1-2 buổi, fix prod-broken):** #1 (debug), #2 (body limit), #3 (event buffer), #16 (clean Dockerfile).  
**Phase B (1 buổi, abuse mitigations):** #5 (rate limit), #7 (CORS), #6 (clientId), #8 (per-IP slot), #13 (zod limits cứng).  
**Phase C (1 buổi, sandbox hardening):** #11 (seccomp), #9 (tmpfs workspace), #4 (verify tmpfs flags).  
**Phase D (theo nhịp):** #12 (rootless/gVisor), #14 (healthcheck), #15 (deploy verify), #17 (DAP race), #18-19 (UX polish).

Sau Phase A debug + Phase B abuse, server có thể coi là "đủ an toàn để public" trên home lab. Phase C-D là defense in depth.
