# Change Log

<!-- Format: mỗi session = 1 entry, mới nhất ở trên -->
<!-- Agent: Claude Code / Codex / Antigravity IDE / Human -->

## 2026-05-27 — Claude Code

**Agent:** Claude Code  
**Files Modified:**
- `apps/frontend/src/App.tsx` — auto-switch sang tab Error List khi compile có lỗi; styled phase messages (⟳ Compiling... / ✓ Compiled / ▶ Running / ✓ Finished / ✗ Exited / ⚠ Timed out)
- `docker/runner-cpp/run-c` — đo runtime bằng `date +%s%N` thay `/usr/bin/time %e` để có độ chính xác millisecond
- `docker/runner-cpp/run-cpp` — như trên
- `docker/runner-python/run-python` — như trên

**Summary:** Cải thiện UX terminal output (thay raw phase markers bằng text thân thiện), tự động chuyển sang Error List khi compile lỗi, và sửa metrics runtime luôn hiển thị 0.00s bằng cách dùng nanosecond clock.

**Deploy status:** Pending — cần `RESTART_APP=1 REBUILD_RUNNER_IMAGES=1 bash bin/pull-latest.sh` để áp dụng thay đổi Docker images.

---

## 2026-05-26 — Claude Code

**Agent:** Claude Code  
**Files Modified:**
- `docker/runner-cpp/debug-dap-c` — compile target từ `/tmp/program` → `/exec/program -lm`
- `docker/runner-cpp/debug-dap-cpp` — compile target từ `/tmp/program` → `/exec/program`
- `apps/runner/src/dapDebugSession.ts` — cải thiện khởi tạo DAP session, diagnostics metrics

**Summary:** Sửa debug feature bị broken do path mismatch sau khi `/tmp` tmpfs thiếu `exec` flag — binary được compile sang `/exec` (có exec flag) để GDB có thể chạy được.

**Deploy status:** Deployed
