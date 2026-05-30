# tests/qc/runner.md — Runner capability checklist

Phạm vi: năng lực chung của runner — Run, Debug, Limits, Abuse, Observability — cho cả 3 ngôn ngữ.
Tham khảo [`INDEX.md`](INDEX.md) cho template + convention. Mỗi scenario gồm 12 trường (Tags / Pre-conditions / Language / Compile flags / Stdin / Argv / Source / UI Steps / Expected / Pass criteria / Failure modes / Related ISSUE).

---

## Section RUN — Compile, IO, exit (TC-RUN-001 → TC-RUN-015)

### TC-RUN-001 — Hello world C

- **Tags**: run, c, basic
- **Pre-conditions**: deployed build, fresh tab
- **Language**: c
- **Compile flags**: default
- **Stdin**: (empty)
- **Argv**: (empty)

```c
#include <stdio.h>
int main(void) { puts("Hello World"); return 0; }
```

**UI Steps**: 1) Chọn C 2) Paste Source 3) Click Run.

**Expected**: stdout `Hello World\n` · exit `0` · pill `Exited`.

**Pass criteria**:
- [ ] Output `Hello World`
- [ ] Pill `Exited`, không error

**Failure modes / Notes**: compile fail → runner image hỏng. ISSUE: (none)

---

### TC-RUN-002 — Hello world C++

- **Tags**: run, cpp, basic
- **Pre-conditions**: fresh tab
- **Language**: cpp
- **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```cpp
#include <iostream>
int main() { std::cout << "Hello World\n"; }
```

**UI Steps**: 1) Chọn C++ 2) Paste 3) Run.

**Expected**: stdout `Hello World\n` · exit `0`.

**Pass criteria**:
- [ ] Output đúng
- [ ] Pill `Exited`

**Failure modes / Notes**: gnu++20 ok. ISSUE: (none)

---

### TC-RUN-003 — Hello world Python

- **Tags**: run, python, basic
- **Pre-conditions**: fresh tab
- **Language**: python
- **Compile flags**: (n/a)
- **Stdin**: (empty) · **Argv**: (empty)

```python
print("Hello World")
```

**UI Steps**: Python → Paste → Run.

**Expected**: stdout `Hello World\n` · exit `0`.

**Pass criteria**:
- [ ] Output đúng
- [ ] Pill `Exited`

**Failure modes / Notes**: Python image hỏng nếu fail. ISSUE: (none)

---

### TC-RUN-004 — Stdin nhiều dòng + dòng không newline cuối

- **Tags**: run, c, stdin
- **Pre-conditions**: fresh tab
- **Language**: c
- **Compile flags**: default
- **Stdin**:
```
alpha
beta
gamma_no_newline
```
- **Argv**: (empty)

```c
#include <stdio.h>
int main(void) {
    char buf[64];
    int i = 0;
    while (fgets(buf, sizeof buf, stdin)) printf("[%d] %s", ++i, buf);
    return 0;
}
```

**UI Steps**: C → Paste → Set Stdin (3 dòng, dòng cuối không newline) → Run.

**Expected**: stdout `[1] alpha\n[2] beta\n[3] gamma_no_newline` · exit `0`.

**Pass criteria**:
- [ ] Đếm đúng 3 dòng
- [ ] Dòng cuối không có `\n` thừa

**Failure modes / Notes**: stdin file mount qua runner workspace. ISSUE: (none)

---

### TC-RUN-005 — Argv có space (quoting)

- **Tags**: run, cpp, argv
- **Pre-conditions**: fresh tab
- **Language**: cpp
- **Compile flags**: default
- **Stdin**: (empty)
- **Argv**: `"hello world" 'foo bar' simple`

```cpp
#include <iostream>
int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i) std::cout << "[" << i << "]=" << argv[i] << "\n";
    return argc - 1;
}
```

**UI Steps**: C++ → Paste → Set Argv `"hello world" 'foo bar' simple` → Run.

**Expected**: stdout
```
[1]=hello world
[2]=foo bar
[3]=simple
```
· exit `3`.

**Pass criteria**:
- [ ] argv split đúng theo `parseArgv()` shared schema
- [ ] Exit code = số args

**Failure modes / Notes**: `parseArgv` ([packages/shared/src/index.ts:157](../../packages/shared/src/index.ts#L157)). ISSUE: (none)

---

### TC-RUN-006 — Stdout vs stderr tách biệt

- **Tags**: run, c, streams
- **Pre-conditions**: fresh tab
- **Language**: c
- **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int main(void) {
    fprintf(stdout, "OUT-line\n");
    fflush(stdout);
    fprintf(stderr, "ERR-line\n");
    return 0;
}
```

**UI Steps**: C → Paste → Run.

**Expected**: panel output tô màu stderr khác stdout (theo CSS hiện tại); cả hai dòng đều hiển thị.

**Pass criteria**:
- [ ] Có `OUT-line`
- [ ] Có `ERR-line` (kiểu render stderr distinct)
- [ ] Exit `0`

**Failure modes / Notes**: phase markers `__RUNNER_PHASE__` không leak ra stdout user. ISSUE: (none)

---

### TC-RUN-007 — Exit code custom 42

- **Tags**: run, c, exit
- **Pre-conditions**: fresh tab
- **Language**: c
- **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
int main(void) { return 42; }
```

**UI Steps**: C → Paste → Run.

**Expected**: exit `42` · pill `Exited (42)` hoặc tương đương.

**Pass criteria**:
- [ ] Status hiển thị exit code 42

**Failure modes / Notes**: ISSUE: (none)

---

### TC-RUN-008 — Exit code 255 (max unsigned 8-bit)

- **Tags**: run, c, exit
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
int main(void) { return 255; }
```

**UI Steps**: C → Paste → Run.

**Expected**: exit `255`.

**Pass criteria**:
- [ ] Exit `255` (không wrap thành -1 / 0)

**Failure modes / Notes**: ISSUE: (none)

---

### TC-RUN-009 — Exit code âm via signal (abort)

- **Tags**: run, cpp, signal
- **Pre-conditions**: fresh tab
- **Language**: cpp · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```cpp
#include <cstdlib>
int main() { std::abort(); }
```

**UI Steps**: C++ → Paste → Run.

**Expected**: exit `null` + signal `SIGABRT` (hoặc 134 = 128+6) · pill phản ánh signal/abort.

**Pass criteria**:
- [ ] Có chỉ báo signal hoặc exit ≠ 0
- [ ] Pill không phải `Exited (0)`

**Failure modes / Notes**: depends on UI surface code/signal in pill. ISSUE: (none)

---

### TC-RUN-010 — Compile error C (syntax)

- **Tags**: run, c, compile-error
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
int main(void) {
    int x = 1
    return x;
}
```

**UI Steps**: C → Paste → Run.

**Expected**: stderr chứa `error:` + `expected ';'` · không qua `__RUNNER_PHASE__:run:start` · pill `Compile Error`/`Error`.

**Pass criteria**:
- [ ] Hiển thị thông điệp lỗi gcc rõ ràng
- [ ] Không có output từ run phase

**Failure modes / Notes**: ISSUE: (none)

---

### TC-RUN-011 — Compile error C++ (template)

- **Tags**: run, cpp, compile-error
- **Pre-conditions**: fresh tab
- **Language**: cpp · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```cpp
#include <vector>
int main() {
    std::vector<int> v;
    v.push_back("not-int");
    return 0;
}
```

**UI Steps**: C++ → Paste → Run.

**Expected**: stderr có error template substitution / `no matching function for call to push_back`.

**Pass criteria**:
- [ ] Thông điệp template error hiển thị
- [ ] Không qua run phase

**Failure modes / Notes**: ISSUE: (none)

---

### TC-RUN-012 — SyntaxError Python

- **Tags**: run, python, parse-error
- **Pre-conditions**: fresh tab
- **Language**: python · **Compile flags**: n/a
- **Stdin**: (empty) · **Argv**: (empty)

```python
def main(
    print("oops")
main()
```

**UI Steps**: Python → Paste → Run.

**Expected**: stderr chứa `SyntaxError` · exit ≠ 0.

**Pass criteria**:
- [ ] `SyntaxError` xuất hiện
- [ ] Exit code phản ánh fail

**Failure modes / Notes**: ISSUE: (none)

---

### TC-RUN-013 — Runtime: segfault (deref NULL)

- **Tags**: run, c, runtime-error
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
int main(void) { int* p = (int*)0; return *p; }
```

**UI Steps**: C → Paste → Run.

**Expected**: signal `SIGSEGV` (11) · exit `null` hoặc 139 · pill phản ánh crash.

**Pass criteria**:
- [ ] Có chỉ báo signal/crash
- [ ] Compile ok, chỉ runtime fail

**Failure modes / Notes**: ISSUE: (none)

---

### TC-RUN-014 — Runtime: C++ uncaught exception

- **Tags**: run, cpp, runtime-error
- **Pre-conditions**: fresh tab
- **Language**: cpp · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```cpp
#include <stdexcept>
int main() { throw std::runtime_error("boom"); }
```

**UI Steps**: C++ → Paste → Run.

**Expected**: stderr `terminate called` + `boom` · SIGABRT.

**Pass criteria**:
- [ ] Stack trace / `terminate` xuất hiện
- [ ] Exit phản ánh abort

**Failure modes / Notes**: ISSUE: (none)

---

### TC-RUN-015 — RecursionError Python

- **Tags**: run, python, runtime-error
- **Pre-conditions**: fresh tab
- **Language**: python · **Compile flags**: n/a
- **Stdin**: (empty) · **Argv**: (empty)

```python
import sys
sys.setrecursionlimit(2000)
def f(n): return f(n+1)
f(0)
```

**UI Steps**: Python → Paste → Run.

**Expected**: stderr `RecursionError: maximum recursion depth exceeded` · exit ≠ 0.

**Pass criteria**:
- [ ] `RecursionError` hiển thị
- [ ] Traceback đầy đủ

**Failure modes / Notes**: ISSUE: (none)

---

## Section DEBUG — DAP capabilities (TC-DBG-001 → TC-DBG-015)

### TC-DBG-001 — C breakpoint + step over + variables

- **Tags**: debug, c, breakpoint, step
- **Pre-conditions**: fresh tab, ngôn ngữ debug-capable
- **Language**: c · **Compile flags**: debug (`-g -O0`)
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int main(void) {
    int a = 1;
    int b = 2;
    int c = a + b;
    printf("%d\n", c);
    return 0;
}
```

**UI Steps**:
1. C → Paste.
2. Click gutter line 4 (`int b = 2;`) để set breakpoint.
3. Click **Debug**.
4. Khi pill `Paused`/`Stopped`, mở tab Variables.
5. Click Step over 2 lần.

**Expected**: dừng tại line 4 → step over → line 5 (`int c = a + b;`) → step over → line 6. Variables panel: `a=1`, `b=2`, `c=3` (sau khi step qua).

**Pass criteria**:
- [ ] Breakpoint trigger đúng line
- [ ] Step over chuyển đúng dòng
- [ ] Variables update sau mỗi step

**Failure modes / ISSUE**: ISSUE-017 (Monaco setValue), ISSUE-016 (debug stdout capture).

---

### TC-DBG-002 — Step into + step out

- **Tags**: debug, c, step-into, step-out
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int add(int x, int y) { return x + y; }
int main(void) {
    int s = add(3, 4);
    printf("%d\n", s);
    return 0;
}
```

**UI Steps**: Set breakpoint line 4 (`int s = add(3,4);`) → Debug → Step into → quan sát stack frame `add` → Step out → quay về `main`.

**Expected**: stack frame chuyển: `main` → `add` (sau step into) → `main` (sau step out). Variables `x=3, y=4` trong frame `add`.

**Pass criteria**:
- [ ] Step into nhảy vào `add`
- [ ] Step out trở về `main`
- [ ] Call stack panel cập nhật

**Failure modes / ISSUE**: (none)

---

### TC-DBG-003 — Watch expression: mutate variable, expect update

- **Tags**: debug, c, watch
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int main(void) {
    int i = 0;
    for (i = 0; i < 5; ++i) { /* loop */ }
    printf("%d\n", i);
    return 0;
}
```

**UI Steps**: Set breakpoint line 4 (`for ...`) → Debug → trong ô Watch nhập `i*2` → Enter → Step over qua từng iter, quan sát watch panel update (0, 2, 4, 6, 8).

**Expected**: watch `i*2` cập nhật theo từng step.

**Pass criteria**:
- [ ] Watch hiển thị giá trị
- [ ] Update sau mỗi step

**Failure modes / ISSUE**: (none)

---

### TC-DBG-004 — Expand mảng C `int arr[10]` (ISSUE-031 regression)

- **Tags**: debug, c, expand, array
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int main(void) {
    int arr[10];
    for (int i = 0; i < 10; ++i) arr[i] = i * i;
    printf("done\n");
    return 0;
}
```

**UI Steps**: Set breakpoint line 5 (`printf`) → Debug → đợi pill `Paused` → Variables panel → click expand `arr`.

**Expected**: 10 child rows tên `"0".."9"` (không phải `"[0]".."[9]"`) với value `0, 1, 4, 9, 16, 25, 36, 49, 64, 81`.

**Pass criteria**:
- [ ] Đủ 10 phần tử
- [ ] Tên child là bare digit (regression ISSUE-031)
- [ ] Giá trị đúng

**Failure modes / ISSUE**: ISSUE-031 (normalizeChildNames).

---

### TC-DBG-005 — Expand struct lồng nhau

- **Tags**: debug, c, expand, struct
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
struct Point { int x, y; };
struct Box { struct Point tl, br; };
int main(void) {
    struct Box b = {{1, 2}, {10, 20}};
    printf("%d\n", b.tl.x);
    return 0;
}
```

**UI Steps**: Breakpoint line 6 (`printf`) → Debug → expand `b` → expand `b.tl` → expand `b.br`.

**Expected**: `b` → 2 children `tl`, `br`; mỗi child expand thành `x`, `y` (1/2 và 10/20).

**Pass criteria**:
- [ ] Cả 2 cấp expand được
- [ ] Giá trị đúng

**Failure modes / ISSUE**: (none)

---

### TC-DBG-006 — Expand linked list (depth 3)

- **Tags**: debug, c, expand, linked-list
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct N { int v; struct N* next; } N;
int main(void) {
    N* c = NULL;
    for (int i = 3; i > 0; --i) {
        N* n = malloc(sizeof(N));
        n->v = i; n->next = c; c = n;
    }
    printf("%d\n", c->v);
    return 0;
}
```

**UI Steps**: Breakpoint line `printf` → Debug → expand `c` → expand `c->next` → expand `c->next->next`.

**Expected**: Mỗi node có `v` + `next`; lần lượt `v = 1, 2, 3`; `next` cuối = NULL.

**Pass criteria**:
- [ ] 3 cấp expand được
- [ ] Giá trị `v` đúng

**Failure modes / ISSUE**: (none)

---

### TC-DBG-007 — Call stack 5 frames (recursion)

- **Tags**: debug, c, stack
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int rec(int n) {
    if (n == 0) { printf("base\n"); return 0; }
    return rec(n - 1);
}
int main(void) { return rec(5); }
```

**UI Steps**: Breakpoint line `printf` → Debug → đợi pill `Paused` → mở Call Stack tab.

**Expected**: ít nhất 6 frames: `rec` × 6 + `main` (hoặc tương đương với inline). Tên function + line number hiển thị.

**Pass criteria**:
- [ ] ≥5 frames `rec` visible
- [ ] Có frame `main`

**Failure modes / ISSUE**: (none)

---

### TC-DBG-008 — Remove watch

- **Tags**: debug, c, watch, remove
- **Pre-conditions**: tiếp nối TC-DBG-003 hoặc fresh
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
int main(void) { int i = 0; for (i = 0; i < 3; ++i); return i; }
```

**UI Steps**: Set bp line 1 → Debug → nhập watch `i+1` → Enter → click X cạnh watch entry để remove.

**Expected**: watch biến mất khỏi panel.

**Pass criteria**:
- [ ] Watch entry không còn render
- [ ] Không có error message

**Failure modes / ISSUE**: (none)

---

### TC-DBG-009 — C/C++ debug stdout capture (ISSUE-016/030 regression)

- **Tags**: debug, c, stdout-capture
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int main(void) {
    for (int i = 0; i < 5; ++i) printf("hello %d\n", i);
    return 0;
}
```

**UI Steps**: Debug (không set bp) → click Continue ngay nếu pause entry → đợi exit.

**Expected**: panel debug output hiển thị 5 dòng `hello 0..4`.

**Pass criteria**:
- [ ] Đủ 5 dòng output
- [ ] Không bị mất do permission denied

**Failure modes / ISSUE**: ISSUE-016 (DapClient.failAll), ISSUE-030 (`chmod tmp/program.out 0o666`).

---

### TC-DBG-010 — Pause running infinite loop

- **Tags**: debug, c, pause
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
int main(void) { volatile int x = 0; while (1) ++x; }
```

**UI Steps**: Debug → đợi pill `Running` → click Pause.

**Expected**: pill chuyển `Paused`/`Stopped` · variables panel hiển thị `x` với giá trị > 0.

**Pass criteria**:
- [ ] Program tạm dừng được
- [ ] Variable `x` hiển thị

**Failure modes / ISSUE**: (none)

---

### TC-DBG-011 — C++ breakpoint trong template instantiation

- **Tags**: debug, cpp, template
- **Pre-conditions**: fresh tab
- **Language**: cpp · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```cpp
#include <iostream>
template<typename T>
T add(T a, T b) { return a + b; }
int main() {
    auto x = add<int>(1, 2);
    auto y = add<double>(1.5, 2.5);
    std::cout << x << " " << y << "\n";
}
```

**UI Steps**: Bp line `T add(...)` body return → Debug → step over từng instantiation → quan sát stack frame `add<int>` rồi `add<double>`.

**Expected**: hai lần dừng tại template body với type khác nhau.

**Pass criteria**:
- [ ] Breakpoint trigger trên cả hai instantiation
- [ ] Stack frame hiển thị tên template

**Failure modes / ISSUE**: (none)

---

### TC-DBG-012 — C++ expand `std::vector<int>` + `std::map<string,int>`

- **Tags**: debug, cpp, expand, stl
- **Pre-conditions**: fresh tab
- **Language**: cpp · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```cpp
#include <vector>
#include <map>
#include <string>
int main() {
    std::vector<int> v = {10,20,30,40,50,60,70,80,90,100};
    std::map<std::string,int> m = {{"a",1},{"b",2},{"c",3}};
    return v.size() + m.size();
}
```

**UI Steps**: Bp `return` → Debug → expand `v` → expand `m`.

**Expected**: `v` expand → 10 children với value 10..100; `m` expand → 3 entries (a/b/c) với value 1/2/3.

**Pass criteria**:
- [ ] Vector hiển thị đủ 10
- [ ] Map hiển thị 3 cặp key-value

**Failure modes / ISSUE**: stdlib pretty-printer GDB. (none)

---

### TC-DBG-013 — Python expand `dict` + `list` + `set`

- **Tags**: debug, python, expand
- **Pre-conditions**: fresh tab
- **Language**: python · **Compile flags**: n/a
- **Stdin**: (empty) · **Argv**: (empty)

```python
d = {"a": 1, "b": 2, "c": 3}
l = [10, 20, 30, 40, 50]
s = {"x", "y", "z"}
print(d, l, s)
```

**UI Steps**: Bp line `print` → Debug → expand `d` / `l` / `s`.

**Expected**: `d` → 3 keys; `l` → 5 items; `s` → 3 items (order tùy implementation).

**Pass criteria**:
- [ ] Cả 3 expand được
- [ ] Giá trị hiển thị

**Failure modes / ISSUE**: ISSUE-032.

---

### TC-DBG-014 — Python watch local

- **Tags**: debug, python, watch
- **Pre-conditions**: fresh tab
- **Language**: python · **Compile flags**: n/a
- **Stdin**: (empty) · **Argv**: (empty)

```python
total = 0
for i in range(5):
    total += i
print(total)
```

**UI Steps**: Bp line `total += i` → Debug → nhập watch `total + i` → step over từng iter.

**Expected**: watch cập nhật 0+0=0, 1+1=2, 3+2=5, 6+3=9, 10+4=14.

**Pass criteria**:
- [ ] Watch update từng step
- [ ] Giá trị tính đúng

**Failure modes / ISSUE**: (none)

---

### TC-DBG-015 — Restart debug session (close + reopen cùng clientId)

- **Tags**: debug, lifecycle, restart
- **Pre-conditions**: tab hiện có debug session đang chạy
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int main(void) { puts("alive"); return 0; }
```

**UI Steps**:
1. Debug → đợi exit hoặc click Stop.
2. Click Debug lại (cùng tab, cùng clientId nội bộ).

**Expected**: session mới start thành công, không bị 409 "Debug session already active".

**Pass criteria**:
- [ ] Lần 2 vào debug bình thường
- [ ] Pill `Running` rồi `Exited`

**Failure modes / ISSUE**: ISSUE-035 (cleanup race).

---

## Section LIMITS — Resource boundaries (TC-LIM-001 → TC-LIM-010)

### TC-LIM-001 — RUN_TIMEOUT_MS (infinite loop)

- **Tags**: limit, timeout, c
- **Pre-conditions**: fresh tab, default config (RUN_TIMEOUT_MS=15000)
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
int main(void) { while (1); }
```

**UI Steps**: C → Paste → Run → đợi ~15s.

**Expected**: container bị SIGKILL sau ~15s · pill `Timed out` · `timedOut=true` trong event exit.

**Pass criteria**:
- [ ] Process bị kill ≈ 15s ± 2s
- [ ] Pill phản ánh timeout

**Failure modes / ISSUE**: nếu kill sau 30s → kiểm tra `RUN_TIMEOUT_SECONDS` env trong runner image.

---

### TC-LIM-002 — DEBUG_MAX_MS (15 min cap)

- **Tags**: limit, debug, max-session
- **Pre-conditions**: cần env override `DEBUG_MAX_MS=10000` để test nhanh (ghi rõ vào pre-conditions của QC run)
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <unistd.h>
int main(void) { while (1) sleep(1); }
```

**UI Steps**: Debug → đợi tới ngưỡng `DEBUG_MAX_MS`.

**Expected**: session bị đóng tự động sau ngưỡng, pill thông báo.

**Pass criteria**:
- [ ] Session tự đóng đúng ngưỡng
- [ ] Slot trả về (mở session mới ok)

**Failure modes / ISSUE**: cần override env trên runner; với default 15 min thì không khả thi chạy thường xuyên.

---

### TC-LIM-003 — DEBUG_IDLE_MS (5 min idle)

- **Tags**: limit, debug, idle
- **Pre-conditions**: env override `DEBUG_IDLE_MS=10000` cho test
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int main(void) {
    int x = 0;
    x = x + 1;
    printf("%d\n", x);
    return 0;
}
```

**UI Steps**: Bp line 3 → Debug → KHÔNG bấm gì sau khi pause → đợi tới ngưỡng idle.

**Expected**: session tự ngắt với lý do idle.

**Pass criteria**:
- [ ] Session ngắt sau ngưỡng
- [ ] Lý do "idle" / message phù hợp

**Failure modes / ISSUE**: cần override env.

---

### TC-LIM-004 — MEMORY_BYTES (alloc 2 GiB)

- **Tags**: limit, memory, c
- **Pre-conditions**: default 1 GiB
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
int main(void) {
    size_t n = (size_t)2 * 1024 * 1024 * 1024;
    char* p = (char*)malloc(n);
    if (!p) { puts("malloc fail"); return 1; }
    memset(p, 1, n);
    puts("done");
    return 0;
}
```

**UI Steps**: C → Paste → Run.

**Expected**: container bị OOM-killed hoặc `malloc` fail · pill `Error`/`Killed`/exit ≠ 0.

**Pass criteria**:
- [ ] Process không print `done`
- [ ] Có chỉ báo OOM hoặc malloc fail

**Failure modes / ISSUE**: (none)

---

### TC-LIM-005 — MAX_OUTPUT_BYTES (5 MiB)

- **Tags**: limit, output-truncation, c
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int main(void) {
    char buf[1024];
    for (size_t i = 0; i < sizeof buf - 1; ++i) buf[i] = 'A';
    buf[sizeof buf - 1] = '\n';
    for (int i = 0; i < 6 * 1024; ++i) fwrite(buf, 1, sizeof buf, stdout);
    return 0;
}
```

**UI Steps**: C → Paste → Run.

**Expected**: output bị truncate tại ~5 MiB · `outputTruncated=true` trong event exit · container bị kill khi exceed.

**Pass criteria**:
- [ ] UI hiển thị thông báo truncated
- [ ] Output không vượt quá 5 MiB

**Failure modes / ISSUE**: (none)

---

### TC-LIM-006 — MAX_SOURCE_BYTES (200_000)

- **Tags**: limit, source-size
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

**Source**: paste 1 file C valid + đệm comment đến ≥200_001 bytes.

```c
// padding: <repeat string `xxxxxxxxxx` để file > 200_000 bytes>
#include <stdio.h>
int main(void) { return 0; }
```

**UI Steps**: paste source dài → Run.

**Expected**: API trả 400 (zod validation) · pill `Error` · không vào compile phase.

**Pass criteria**:
- [ ] 400 từ /run hoặc /debug
- [ ] Không compile

**Failure modes / ISSUE**: (none)

---

### TC-LIM-007 — MAX_STDIN_BYTES (1_000_000)

- **Tags**: limit, stdin-size
- **Pre-conditions**: fresh tab
- **Language**: python · **Compile flags**: n/a
- **Stdin**: (paste 1_000_001 bytes, e.g. `python -c 'print("A"*1000001)' | clip`)
- **Argv**: (empty)

```python
import sys
data = sys.stdin.read()
print(len(data))
```

**UI Steps**: paste stdin lớn → Run.

**Expected**: 400 từ /run vì zod fail.

**Pass criteria**:
- [ ] 400 hoặc UI báo invalid input
- [ ] Không vào run phase

**Failure modes / ISSUE**: (none)

---

### TC-LIM-008 — MAX_ARG_COUNT (33 args)

- **Tags**: limit, argv-count
- **Pre-conditions**: fresh tab
- **Language**: python · **Compile flags**: n/a
- **Stdin**: (empty)
- **Argv**: `a1 a2 a3 ... a33` (33 args)

```python
import sys
print(len(sys.argv) - 1)
```

**UI Steps**: paste argv 33 args → Run.

**Expected**: 400 (zod max 32).

**Pass criteria**:
- [ ] 400
- [ ] Không vào run phase

**Failure modes / ISSUE**: (none)

---

### TC-LIM-009 — MAX_ARG_BYTES (1 arg 257 bytes)

- **Tags**: limit, argv-bytes
- **Pre-conditions**: fresh tab
- **Language**: python · **Compile flags**: n/a
- **Stdin**: (empty)
- **Argv**: `"AAAA...×257"` (chuỗi A dài 257 ký tự, quoted)

```python
import sys
print(len(sys.argv[1]))
```

**UI Steps**: paste argv 1 arg dài 257 → Run.

**Expected**: 400 (zod max 256).

**Pass criteria**:
- [ ] 400
- [ ] Không vào run phase

**Failure modes / ISSUE**: (none)

---

### TC-LIM-010 — MAX_CONCURRENT_JOBS (cap 6)

- **Tags**: limit, concurrency
- **Pre-conditions**: 6 tab/khách đã chạy debug song song
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
int main(void) { while (1); }
```

**UI Steps**: Mở 7 tab → mỗi tab Debug. Tab thứ 7 expected fail.

**Expected**: tab 7 nhận 429 "Runner is busy" · pill `Error`.

**Pass criteria**:
- [ ] Tab 7 không khởi động được session
- [ ] Sau khi 1 tab cũ stop → tab 7 vào được

**Failure modes / ISSUE**: ISSUE-035 (cleanup race khiến cap hết slot tạm thời).

---

## Section ABUSE — Sandbox boundary (TC-ABS-001 → TC-ABS-011)

### TC-ABS-001 — Fork bomb (PidsLimit 128)

- **Tags**: abuse, fork, c
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <unistd.h>
int main(void) { while (1) fork(); }
```

**UI Steps**: C → Paste → Run.

**Expected**: process tạo tới ~128 → `fork()` bắt đầu fail · container vẫn bị kill cuối cùng theo timeout/output limit · host không bị down.

**Pass criteria**:
- [ ] Số process bị giới hạn
- [ ] Host runner/api còn responsive
- [ ] Tab khác vẫn dùng được

**Failure modes / ISSUE**: nếu host chậm/lag → PidsLimit thiếu hiệu lực, check `HostConfig.PidsLimit`.

---

### TC-ABS-002 — Network từ C (NetworkDisabled)

- **Tags**: abuse, network, c
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
int main(void) {
    int s = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in a = {0};
    a.sin_family = AF_INET; a.sin_port = htons(80);
    inet_pton(AF_INET, "1.1.1.1", &a.sin_addr);
    int r = connect(s, (struct sockaddr*)&a, sizeof a);
    perror("connect");
    return r;
}
```

**UI Steps**: C → Paste → Run.

**Expected**: `connect: Network is unreachable` hoặc `EHOSTUNREACH` · exit ≠ 0.

**Pass criteria**:
- [ ] Network fail rõ ràng
- [ ] Không có lookup DNS thành công

**Failure modes / ISSUE**: nếu connect thành công → NetworkDisabled config sai.

---

### TC-ABS-003 — Network từ Python (requests)

- **Tags**: abuse, network, python
- **Pre-conditions**: fresh tab
- **Language**: python · **Compile flags**: n/a
- **Stdin**: (empty) · **Argv**: (empty)

```python
import requests
try:
    r = requests.get("https://example.com", timeout=3)
    print("OK", r.status_code)
except Exception as e:
    print("FAIL", type(e).__name__, e)
```

**UI Steps**: Python → Paste → Run.

**Expected**: stdout `FAIL ConnectionError ...` (hoặc gaierror/NewConnectionError).

**Pass criteria**:
- [ ] In `FAIL`
- [ ] Không in `OK 200`

**Failure modes / ISSUE**: (none)

---

### TC-ABS-004 — Write `/etc/passwd` (ReadonlyRootfs)

- **Tags**: abuse, fs, readonly
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int main(void) {
    FILE* f = fopen("/etc/passwd", "w");
    if (!f) { perror("fopen"); return 1; }
    fputs("malicious\n", f);
    fclose(f);
    return 0;
}
```

**UI Steps**: C → Paste → Run.

**Expected**: `fopen: Read-only file system` (EROFS) · exit 1.

**Pass criteria**:
- [ ] EROFS hoặc tương đương
- [ ] Không thành công ghi

**Failure modes / ISSUE**: (none)

---

### TC-ABS-005 — chroot() (CapDrop ALL)

- **Tags**: abuse, capability
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
#include <unistd.h>
int main(void) {
    int r = chroot("/tmp");
    perror("chroot");
    return r;
}
```

**UI Steps**: C → Paste → Run.

**Expected**: `chroot: Operation not permitted` (EPERM) · exit ≠ 0.

**Pass criteria**:
- [ ] EPERM
- [ ] Không thay đổi root

**Failure modes / ISSUE**: (none)

---

### TC-ABS-006 — Read `/proc/1/environ` (cap dropped, no access)

- **Tags**: abuse, info-leak, proc
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int main(void) {
    FILE* f = fopen("/proc/1/environ", "r");
    if (!f) { perror("fopen"); return 1; }
    char buf[1024];
    size_t n = fread(buf, 1, sizeof buf, f);
    fwrite(buf, 1, n, stdout);
    return 0;
}
```

**UI Steps**: C → Paste → Run.

**Expected**: hoặc EACCES (permission denied), hoặc nội dung chỉ thuộc init container hiện tại (không leak runner host env).

**Pass criteria**:
- [ ] Không có biến môi trường nhạy cảm (DOCKER_*, AWS_*, ...) leak
- [ ] (Tốt nhất) EACCES

**Failure modes / ISSUE**: nếu leak DOCKER_SOCKET path → security issue.

---

### TC-ABS-007 — Deep recursion (stack overflow)

- **Tags**: abuse, stack, c
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
void f(int n) { char buf[1024]; buf[0] = (char)n; f(n + 1); }
int main(void) { f(0); return 0; }
```

**UI Steps**: C → Paste → Run.

**Expected**: SIGSEGV (stack overflow) · exit `null`/139.

**Pass criteria**:
- [ ] Crash do stack overflow
- [ ] Container bị reclaim đúng

**Failure modes / ISSUE**: (none)

---

### TC-ABS-008 — WebSocket reconnect tới cùng debug session

- **Tags**: abuse, ws, reconnect
- **Pre-conditions**: 1 tab có debug session active (pause tại bp)
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int main(void) { int x = 1; printf("%d\n", x); return 0; }
```

**UI Steps**:
1. Debug → pause tại line 2.
2. Mở DevTools, kill WebSocket (Network → context menu close).
3. Reload tab.
4. Cùng clientId vào lại.

**Expected**: tab reload → reattach hoặc tạo session mới. Không lỗi 500. Replay events nếu reattach.

**Pass criteria**:
- [ ] Không lỗi server 500
- [ ] Tab dùng được tiếp

**Failure modes / ISSUE**: ISSUE-035 cleanup race liên quan.

---

### TC-ABS-009 — ClientId xung đột (409)

- **Tags**: abuse, debug, conflict
- **Pre-conditions**: cần 2 client gọi REST trực tiếp (curl) với cùng `clientId`
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
int main(void) { return 0; }
```

**UI Steps (test bằng curl)**:
```bash
curl -X POST http://localhost:4000/api/debug \
  -H 'content-type: application/json' \
  -d '{"language":"c","source":"int main(){return 0;}","clientId":"X","breakpoints":[]}'
# chạy 2 lần liên tục
```

**Expected**: lần 1 → 200; lần 2 → 409 "Debug session already active".

**Pass criteria**:
- [ ] 409 cho request thứ 2
- [ ] Không có 2 session cùng clientId

**Failure modes / ISSUE**: (none)

---

### TC-ABS-010 — Spam debug commands khi running

- **Tags**: abuse, debug, spam
- **Pre-conditions**: debug session đang running (continue)
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <unistd.h>
int main(void) { while (1) usleep(100000); }
```

**UI Steps**: Debug → Continue → spam click Step Over 20 lần.

**Expected**: hoặc command bị reject (button disabled khi running), hoặc queued nhưng server không crash.

**Pass criteria**:
- [ ] Server không crash
- [ ] Không có lỗi 500 trong runner log

**Failure modes / ISSUE**: (none)

---

### TC-ABS-011 — WS close trong khi container chưa tear down xong

- **Tags**: abuse, ws, teardown
- **Pre-conditions**: 1 tab debug active
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
int main(void) { return 0; }
```

**UI Steps**:
1. Debug → close tab ngay khi pill `Stopped`.
2. SSH server: `docker ps --filter "name=runner-debug" --format '{{.ID}} {{.Status}}'`.
3. Đợi 5s → check lại.

**Expected**: ngay sau close có 1 container đang `Up` (đang remove); sau 5s thì gone.

**Pass criteria**:
- [ ] Container biến mất sau ≤5s
- [ ] Slot trả về (mở debug mới ngay được)

**Failure modes / ISSUE**: ISSUE-035 (slot release timing).

---

## Section OBSERVABILITY — Log redaction, phase markers, teardown (TC-OBS-001 → TC-OBS-006)

### TC-OBS-001 — Fastify log không chứa `source`

- **Tags**: observe, log-redaction
- **Pre-conditions**: SSH access vào server để xem log
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int main(void) {
    puts("MAGIC_STRING_REDACT_ME_SOURCE");
    return 0;
}
```

**UI Steps**:
1. C → Paste → Run.
2. SSH server: `docker compose logs runner --tail=200 | grep MAGIC_STRING_REDACT_ME_SOURCE`.

**Expected**: grep trả empty (source bị Fastify redact ở `req.body.source`).

**Pass criteria**:
- [ ] Log không chứa string magic từ source
- [ ] Vẫn thấy log của job (id) bình thường

**Failure modes / ISSUE**: nếu thấy magic → log redaction bị bỏ.

---

### TC-OBS-002 — Fastify log không chứa `stdin`

- **Tags**: observe, log-redaction
- **Pre-conditions**: SSH access
- **Language**: python · **Compile flags**: n/a
- **Stdin**: `STDIN_REDACT_ME_SECRET_LINE\n`
- **Argv**: (empty)

```python
import sys
print("read", len(sys.stdin.read()))
```

**UI Steps**: Python → Paste → Set Stdin → Run; grep `STDIN_REDACT_ME` server log.

**Expected**: grep empty.

**Pass criteria**:
- [ ] Log không chứa stdin
- [ ] Job log vẫn ghi nhận

**Failure modes / ISSUE**: (none)

---

### TC-OBS-003 — Fastify log không chứa `argv`

- **Tags**: observe, log-redaction
- **Pre-conditions**: SSH access
- **Language**: python · **Compile flags**: n/a
- **Stdin**: (empty)
- **Argv**: `ARGV_REDACT_ME_TOKEN`

```python
import sys
print("argc", len(sys.argv))
```

**UI Steps**: Python → Paste → Set Argv → Run; grep `ARGV_REDACT_ME_TOKEN` server log.

**Expected**: grep empty.

**Pass criteria**:
- [ ] Log không chứa argv
- [ ] Job log vẫn ghi nhận

**Failure modes / ISSUE**: (none)

---

### TC-OBS-004 — Phase markers thứ tự

- **Tags**: observe, phases
- **Pre-conditions**: fresh tab + DevTools Network → SSE/WS frames
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <stdio.h>
int main(void) { puts("ok"); return 0; }
```

**UI Steps**: C → Paste → Run → mở DevTools Network → frames của `/api/run/:id/events`.

**Expected**: event sequence: `ready` → `compile:start` → `compile:done` → `run:start` → `stdout` → `exit`.

**Pass criteria**:
- [ ] Đủ 4 phase chính, thứ tự đúng
- [ ] Không có `run:start` trước `compile:done`

**Failure modes / ISSUE**: phaseFilter.ts hỏng nếu sai. (none)

---

### TC-OBS-005 — Container teardown khi WS close (run job)

- **Tags**: observe, teardown
- **Pre-conditions**: SSH access
- **Language**: c · **Compile flags**: default
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <unistd.h>
int main(void) { sleep(10); return 0; }
```

**UI Steps**:
1. C → Paste → Run.
2. SSH: `docker ps --filter "ancestor=internal-code-runner-cpp:0.1.0"` → thấy 1 container.
3. Close tab ngay.
4. Đợi 3s, check lại.

**Expected**: container gone trong vòng 3s.

**Pass criteria**:
- [ ] Container không tồn tại sau ≤3s
- [ ] Job slot trả về

**Failure modes / ISSUE**: ISSUE-035.

---

### TC-OBS-006 — Refresh browser giữa debug session

- **Tags**: observe, lifecycle, refresh
- **Pre-conditions**: fresh tab
- **Language**: c · **Compile flags**: `-g -O0`
- **Stdin**: (empty) · **Argv**: (empty)

```c
#include <unistd.h>
int main(void) { while (1) sleep(1); }
```

**UI Steps**:
1. Debug → đợi pill `Running`.
2. Ctrl+Shift+R (hard reload).
3. Sau reload, click Debug lại với cùng clientId nội bộ.

**Expected**: session mới start được; không có 409; không còn container thừa của session cũ.

**Pass criteria**:
- [ ] Session mới ok
- [ ] Container cũ đã teardown

**Failure modes / ISSUE**: ISSUE-035.

---

## Tổng kết Section RUN/DEBUG/LIMITS/ABUSE/OBSERVABILITY

- RUN: 15 scenario (TC-RUN-001..015)
- DEBUG: 15 scenario (TC-DBG-001..015)
- LIMITS: 10 scenario (TC-LIM-001..010)
- ABUSE: 11 scenario (TC-ABS-001..011)
- OBSERVABILITY: 6 scenario (TC-OBS-001..006)
- **Tổng**: 57 scenario.

QC verify mẫu ngẫu nhiên ≥3 scenario / section sau mỗi deploy lớn.
