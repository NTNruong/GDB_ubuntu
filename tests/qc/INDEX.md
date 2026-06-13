# QC Capability Test Checklist — INDEX

Bộ test case manual cho GDB_ubuntu (tailnet-only online code runner: C `gnu17`, C++ `gnu++20`, Python 3.12, JavaScript (Node 22), Java (JDK 17/21/25), Go, Rust — DAP debug cho C/C++/Python/Rust).
Phạm vi: phủ **năng lực** của runner + 7 ngôn ngữ, **không thay thế** Playwright e2e tự động.

## Cách dùng

1. Mở browser tới `http://localhost:5173` (dev) hoặc `http://<server>:8080` (prod).
2. Chọn ngôn ngữ + paste **Source** từ scenario.
3. Set **Stdin** + **Argv** nếu scenario yêu cầu.
4. Click **Run** hoặc **Debug** theo bước UI.
5. Đối chiếu **Expected** + tick **Pass criteria**.
6. Ghi ngày verify cạnh ID scenario (không sửa file trong git → ghi vào `LOG.md` hoặc PR comment).

> Không có cột Status trong checklist (file commit vào git). QC ghi "Verified <YYYY-MM-DD>" vào `LOG.md` entry hoặc PR description.

## Files

| File | Phạm vi | Đầu mục |
|------|---------|---------|
| [`runner.md`](runner.md) | Runner năng lực chung (run/debug/limits/abuse/observe) | TC-RUN, TC-DBG, TC-LIM, TC-ABS, TC-OBS |
| [`c-embedded.md`](c-embedded.md) | C firmware-embedded (Register/MMIO, RTOS, DS+Math+Protocol) | TC-C-REG, TC-C-RTOS, TC-C-DS (001–050) |
| [`c-dsa.md`](c-dsa.md) | C classic DSA (array/list/stack/queue/tree/heap/graph/sort/backtrack/DP) | TC-C-DS (051–090) |
| [`cpp.md`](cpp.md) | C++ STL + gnu++20 + threading + firmware-adjacent | TC-CPP |
| [`python.md`](python.md) | Python 3.12 smoke + asyncio + showcase | TC-PY |
| [`javascript.md`](javascript.md) | JavaScript (Node 22) run-only smoke + showcase | TC-JS |
| [`java.md`](java.md) | Java run-only + version selector 17/21/25 + showcase | TC-JAVA |
| [`go.md`](go.md) | Go run-only smoke + showcase (debug = Phase 3b) | TC-GO |
| [`rust.md`](rust.md) | Rust run + DAP debug + showcase | TC-RUST |

## Convention ID

| Prefix         | Phạm vi |
|----------------|---------|
| `TC-RUN-###`   | Compile/run/IO (stdin, argv, stdout, stderr, exit code) |
| `TC-DBG-###`   | Debug DAP: breakpoint, step, watch, expand, stack, restart |
| `TC-LIM-###`   | Resource limits (timeout, memory, output, source/stdin/argv max, concurrency) |
| `TC-ABS-###`   | Boundary/abuse (fork bomb, network, escape sandbox, deep recursion, WS abuse) |
| `TC-OBS-###`   | Observability (log redaction, phase markers, teardown determinism) |
| `TC-C-REG-###` | C — Register/MMIO/GPIO/UART/SPI/I2C/CAN/DMA/IRQ |
| `TC-C-RTOS-###`| C — pthread-based RTOS concepts |
| `TC-C-DS-###`  | C — Data structures & algorithms. **001–050** firmware DS/Math/Protocol → [`c-embedded.md`](c-embedded.md); **051–090** classic CS DSA → [`c-dsa.md`](c-dsa.md) |
| `TC-CPP-###`   | C++ |
| `TC-PY-###`    | Python |
| `TC-JS-###`    | JavaScript (Node 22) — run-only |
| `TC-JAVA-###`  | Java — run-only + version selector (17/21/25) |
| `TC-GO-###`    | Go — run-only (debug pending Phase 3b) |
| `TC-RUST-###`  | Rust — run + DAP debug |

Số đánh 3 chữ số (001, 010, 099, 100...) reset theo prefix. **Ngoại lệ:** `TC-C-DS-###` đánh số liên tục xuyên 2 file (c-embedded.md 001–050, c-dsa.md 051–090) — không reset.

## Template scenario (12 fields)

Mỗi scenario gồm: `Tags`, `Pre-conditions`, `Language`, `Compile flags`, `Stdin`, `Argv`, `Source` (inline code block), `UI Steps`, `Expected`, `Pass criteria` (tick-box), `Failure modes`, `Related ISSUE / Notes`.

## Limits map (sync với [`packages/shared/src/index.ts`](../../packages/shared/src/index.ts) + [`apps/runner/src/config.ts`](../../apps/runner/src/config.ts))

| Const | Default | Scenario verify |
|-------|---------|-----------------|
| `MAX_SOURCE_BYTES`     | 200_000 (≈195 KiB) | TC-LIM-006 |
| `MAX_STDIN_BYTES`      | 1_000_000 (≈976 KiB) | TC-LIM-007 |
| `MAX_ARG_COUNT`        | 32 | TC-LIM-008 |
| `MAX_ARG_BYTES`        | 256 | TC-LIM-009 |
| `MAX_OUTPUT_BYTES`     | 5 MiB | TC-LIM-005 |
| `RUN_TIMEOUT_MS`       | 15_000 | TC-LIM-001 |
| `DEBUG_MAX_MS`         | 900_000 (15 min) | TC-LIM-002 |
| `DEBUG_IDLE_MS`        | 300_000 (5 min) | TC-LIM-003 |
| `MEMORY_BYTES`         | 1 GiB | TC-LIM-004 |
| `NANO_CPUS`            | 1.0 | (gián tiếp, qua throughput) |
| `MAX_CONCURRENT_JOBS`  | 6 | TC-LIM-010 |
| Container `PidsLimit`  | 128 | TC-ABS-001 |
| Container `NetworkDisabled` | true | TC-ABS-002, TC-ABS-003 |
| Container `ReadonlyRootfs` | true | TC-ABS-004 |
| Container `CapDrop`    | ALL | TC-ABS-005, TC-ABS-006 |

## Feature matrix

Hàng = feature, cột = ngôn ngữ, ô = các scenario ID phủ.

| Feature | C | C++ | Python |
|---------|----|-----|--------|
| Hello world | TC-RUN-001 | TC-RUN-002 | TC-RUN-003 |
| stdin nhiều dòng | TC-RUN-004 | TC-RUN-004 | TC-RUN-004 |
| argv quoting | TC-RUN-005 | TC-RUN-005 | TC-RUN-005 |
| stderr tách stdout | TC-RUN-006 | TC-RUN-006 | TC-RUN-006 |
| Exit code 42 | TC-RUN-007 | TC-RUN-007 | TC-RUN-007 |
| Compile/Syntax error | TC-RUN-010 | TC-RUN-011 | TC-RUN-012 |
| Runtime crash | TC-RUN-013 | TC-RUN-014 | TC-RUN-015 |
| Breakpoint + step | TC-DBG-001 | TC-DBG-011 | TC-DBG-013 |
| Step into/out | TC-DBG-002 | TC-DBG-011 | TC-DBG-013 |
| Watch expression | TC-DBG-003 | — | TC-DBG-014 |
| Expand array | TC-DBG-004 | — | — |
| Expand struct | TC-DBG-005 | — | — |
| Expand STL container | — | TC-DBG-012 | — |
| Expand dict/list/set | — | — | TC-DBG-013 |
| Call stack | TC-DBG-007 | TC-DBG-011 | TC-DBG-013 |
| Restart session | TC-DBG-015 | TC-DBG-015 | TC-DBG-015 |
| Network disabled | TC-ABS-002 | TC-ABS-002 | TC-ABS-003 |
| Log redaction | TC-OBS-001..003 | TC-OBS-001..003 | TC-OBS-001..003 |
| C embedded (REG/MMIO) | `c-embedded.md` § REGISTER | — | — |
| C RTOS (pthread) | `c-embedded.md` § RTOS | — | — |
| C DS/Math/Protocol (firmware) | `c-embedded.md` § DS | — | — |
| C classic array/string | `c-dsa.md` TC-C-DS-051..058 | — | — |
| C linked list | `c-dsa.md` TC-C-DS-059..063 | — | — |
| C stack/queue | `c-dsa.md` TC-C-DS-064..068 | — | — |
| C tree/BST | `c-dsa.md` TC-C-DS-069..075 | — | — |
| C heap | `c-dsa.md` TC-C-DS-076..078 | — | — |
| C graph (BFS/DFS/Dijkstra/DSU) | `c-dsa.md` TC-C-DS-079..085 | — | — |
| C sorting | `c-dsa.md` TC-C-DS-086..088 | — | — |
| C backtracking/DP | `c-dsa.md` TC-C-DS-089..090 | — | — |
| C++ STL | — | `cpp.md` § STL | — |
| C++ gnu++20 | — | `cpp.md` § Modern | — |
| C++ threading | — | `cpp.md` § Threading | — |
| C++ firmware-adjacent | — | `cpp.md` § Firmware | — |
| Python asyncio | — | — | TC-PY-006..007 |
| Python typing/dataclass | — | — | TC-PY-004..005 |

## Feature matrix — added languages (JS / Java / Go / Rust)

Hàng = feature, cột = ngôn ngữ, ô = các scenario ID phủ.

| Feature | JavaScript | Java | Go | Rust |
|---------|-----------|------|----|------|
| Hello + argv | TC-JS-001 | TC-JAVA-001 | TC-GO-001 | TC-RUST-001 |
| stdin | TC-JS-002 | TC-JAVA-002 | TC-GO-002 | TC-RUST-002 |
| stderr split | TC-JS-003 | TC-JAVA-003 | TC-GO-003 | TC-RUST-003 |
| Exit code 42 | TC-JS-004 | TC-JAVA-004 | TC-GO-004 | TC-RUST-004 |
| Compile/Syntax error | TC-JS-005 | TC-JAVA-005 | TC-GO-005 | TC-RUST-005 |
| Runtime crash | TC-JS-006 | TC-JAVA-006 | TC-GO-006 | TC-RUST-006 |
| Language showcase | TC-JS-007..012 | TC-JAVA-010..013 | TC-GO-007..011 | TC-RUST-007..011 |
| Network blocked | TC-JS-013 | TC-JAVA-014 | TC-GO-012..013 | TC-RUST-012 |
| Version selector | — | TC-JAVA-007..009 | — | — |
| Debug (DAP) | — (hidden) | — (hidden) | — (Phase 3b) | TC-RUST-013..016 |

> Debug khả dụng hôm nay: chỉ **Rust** (gdb DAP). JavaScript/Java run-only; Go debug đến ở Phase 3b (Delve + socat).

## Related ISSUES → regression scenario

| ISSUE | Status | Regression scenario |
|-------|--------|---------------------|
| ISSUE-016 | PASSED | TC-DBG-009 (C/C++ debug stdout capture) |
| ISSUE-017 | PASSED | TC-DBG-001 (Monaco editor setValue) |
| ISSUE-030 | PASSED | TC-DBG-009 (program.out perms 0o666) |
| ISSUE-031 | PASSED | TC-DBG-004 (expand array `arr` → "0".."9" naming) |
| ISSUE-032 | PASSED | TC-DBG-013 (Python expand dict/list) |
| ISSUE-034 | PASSED | (UI layout — out of scope cho checklist này) |
| ISSUE-035 | OPEN  | (UI inputs full-width; e2e flake riêng) |

## Verification của chính checklist trước khi commit

1. Mọi code block C: `gcc -std=gnu17 -O2 -Wall -Wextra -lm <file>` phải compile.
2. Mọi code block C++: `g++ -std=gnu++20 -O2 -Wall -Wextra <file>` phải compile.
3. Mọi code block Python: `python3 -I -c "compile(open('<file>').read(), '<file>', 'exec')"` phải parse.
4. Mọi code block JavaScript: `node --check <file>` phải parse.
5. Mọi code block Java: `javac <file>` (JDK 17/21/25) phải compile.
6. Mọi code block Go: `go vet` / `go build` phải compile.
7. Mọi code block Rust: `rustc --edition 2021 <file>` phải compile.
8. Mỗi prefix có ≥1 scenario.
9. ID không duplicate, đánh số liên tục trong nhóm.
