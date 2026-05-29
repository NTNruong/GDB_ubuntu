# Change Log

## 2026-05-29 — Claude Code (session 22) — Debug layout fix v3: constrain cột `.workspace` để editor/bottom không tràn đè inspector (đóng ISSUE-028)

**Agent:** Claude Code
**Files Modified:**
- `apps/frontend/src/styles.css` — fix gốc residual ISSUE-028 (QC session 4 phát hiện + chứng minh CSS-injection): `.workspace` thiếu `grid-template-columns` nên cột ngầm = `auto` (=max-content), Monaco phồng ra full viewport ⇒ `.editor-panel`/`.bottom-panel` = 1600px (vượt box `.workspace` 1114px), tràn đè vùng inspector + sinh scrollbar ngang. Thêm `.workspace { grid-template-columns: minmax(0,1fr); overflow: hidden }` (đối xứng pattern đã thắng ở `.content-area` session 21) + `min-width:0` cho `.editor-panel`, `.bottom-panel`, `.result-card` để các grid item co vừa cột (Monaco `automaticLayout` fit theo).
- `tests/e2e/app.spec.ts` — thêm guard bắt đúng regression này vào test side-panel (test cũ chỉ kiểm panel phải nên lọt lỗi editor/bottom tràn): assert `.editor-panel`/`.bottom-panel` width ≤ `.workspace` width, editor không đè panel phải (`ep.x+ep.width ≤ sidePanel.x`), và `documentElement.scrollWidth ≤ clientWidth` (không overflow ngang).

**Summary:** Đây là cùng lỗi Monaco-blowout như session 21 nhưng sâu hơn 1 cấp: session 21 đã constrain ở `.content-area` (`minmax(0,1fr)` + `.workspace{min-width:0}`) nên `.workspace` đúng = 1114px, nhưng **bên trong** `.workspace` chỉ set `grid-template-rows`, cột ngầm `auto` vẫn để Monaco phồng `.editor-panel`/`.bottom-panel` ra full viewport, đè lên panel phải (nhìn đen/trống) + scrollbar ngang. Fix = áp đúng pattern `minmax(0,1fr)` + `min-width:0` cho `.workspace` và grid item của nó. Verify 3 cách trước khi sửa: đọc code (workspace thiếu grid-template-columns), QC đo live (editor/bottom=1600 trong khi workspace=1114), QC CSS-injection proof.

**Deploy status:** Tự deploy khi push `main` (auto-deploy GitHub Actions). **Frontend-only**: `apps/frontend/src/styles.css` + `tests/e2e/app.spec.ts`. Không đụng `docker/` ⇒ runner-images **KHÔNG** rebuild; chỉ frontend service rebuild + recreate qua `docker compose up --build -d`.

**Verification:** `npm run typecheck` ✓, `npm test` ✓ 42 passed / 10 skipped, `npm run build -w @internal/frontend` ✓ (vite 1770 modules). E2E chưa chạy local (cần live server) — QC verify sau deploy: panel phải hiện nội dung Variables/Call Stack/Watches (không còn đen/trống), không còn scrollbar ngang, `.editor-panel.width ≈ .workspace.width` (không còn =1600), `documentElement.scrollWidth ≤ innerWidth`.

## 2026-05-29 — Codex (session 4) — QC verify Claude session 21 debug layout v2

**Agent:** Codex QC
**Files Modified:**
- `ISSUES.md` — updated ISSUE-020/028 and added a residual note to ISSUE-013 after live verification of Claude Code session 21.
- `LOG.md` — recorded this QC verification summary.
- `test-results/qc-session21-layout-tailnet.png` — Playwright evidence screenshot for the session 21 layout state on `https://gdb.char-newton.ts.net`.

**Summary:** Reviewed Claude session 21 and verified the new wrapper-based layout exists: `.content-area.debug-active` splits below the 100% topbar into left workspace, horizontal resize handle, and right inspector. Baseline `npm run typecheck` and `npm test` passed. Live e2e against `localhost:8080` passed 9/10; the only failure was the existing ISSUE-013 Stop -> Debug restart test once, while a targeted restart probe immediately afterward passed with both `/api/debug` calls returning 202 and the second session reaching `breakpoint`.

**Findings:** ISSUE-020 resize capability is now verified: vertical editor/bottom resize changed editor height and double-click reset restored it; horizontal inspector resize changed the side-panel width and double-click reset restored 30%. ISSUE-028 remains OPEN: the side panel itself now has real width and is inside the viewport, but `.workspace` still creates an implicit grid column at the old/full viewport width. At 1600px viewport, `.workspace.width=1114`, yet `.editor-panel.width=1600` and `.bottom-panel.width=1600`; after dragging the right inspector, workspace changed to 1044px but editor/bottom stayed 1600px. This matches the user report that the right area appears blank/covered and there can still be a horizontal scrollbar. A CSS-injection proof showed `.workspace { grid-template-columns: minmax(0, 1fr); overflow: hidden }` plus constrained `.editor-panel`/`.bottom-panel` reduces Monaco/editor/bottom to the left column width.

**Deploy status:** No deploy — QC/test-only session. No product source changes.

**Verification:** `npm run typecheck` ✓, `npm test` ✓ 42 passed / 10 skipped, `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` ✗ 9/10 due residual ISSUE-013 flake, targeted layout probes reproduced remaining ISSUE-028, targeted Stop -> Debug restart probe passed.

## 2026-05-29 — Claude Code (session 21) — Debug layout fix v2: cột inspector full-height + kéo được (ISSUE-028, đóng ISSUE-020)

**Agent:** Claude Code
**Files Modified:**
- `apps/frontend/src/App.tsx` — sửa lỗi layout session 20: nhấc `<aside className="debug-side-panel">` ra **khỏi** `.editor-panel`, bọc `<main className="workspace">` + handle + aside trong wrapper mới `<div className="content-area">` (sibling của `<header>` trong `.app-shell`). Thêm state `inspectorWidth` (default 30) + `isDraggingX`, ref `contentAreaRef`, callback `startResizeX` (mirror resize dọc: throttle 16ms, `pct=(rect.right-clientX)/rect.width*100`, clamp 15–55, layout() ở mouseup). Thêm `<div className="resize-handle-x">` (chỉ khi `isDebugActive`, double-click reset 30%). `.editor-panel` trả về class thường (bỏ `debug-split`).
- `apps/frontend/src/styles.css` — xoá `.editor-panel.debug-split` (gốc lỗi: `7fr 3fr` có min `auto` ⇒ Monaco phồng track trái, ép panel phải width=0/offscreen). Thêm `.content-area` (grid 1 cột) + `.content-area.debug-active { grid-template-columns: minmax(0,1fr) 6px var(--inspector-width,30%) }` (track trái `minmax(0,…)` ⇒ Monaco không phồng được — fix gốc). Thêm `.resize-handle-x` (ew-resize, grip dọc). `.workspace` thêm `min-width:0`; `.debug-side-panel` thêm `border-left`. Mobile (`max-width:860px`): `.content-area.debug-active` về 1 cột + ẩn `.resize-handle-x`.
- `tests/e2e/app.spec.ts` — thêm guard chống chính regression session 20: sau khi dừng breakpoint, `.debug-side-panel` boundingBox phải `width>120` và nằm trong viewport (`x+width ≤ viewport.width+2`).

**Summary:** Root cause (QC xác nhận): session 20 đặt split trong `.editor-panel` với `grid-template-columns: 7fr 3fr` — `fr` track min ngầm `auto` nên min-content rất lớn của Monaco đẩy phồng cột trái, ép `.debug-side-panel` xuống width=0 và tràn ra ngoài viewport (data Variables `n=6/result=36` vẫn có trong DOM, chỉ bị đẩy off-screen). Fix theo hướng QC + user chốt (user chọn resizable): topbar 100%, vùng dưới chia 70% trái (editor+bottom) | 30% phải (inspector full-height) qua wrapper `.content-area`; cột phải kéo được bằng `.resize-handle-x`. Mấu chốt kỹ thuật: dùng `minmax(0,1fr)` cho cột trái để Monaco không phồng track.

**Deploy status:** Tự deploy khi push `main` (auto-deploy GitHub Actions). **Frontend-only**: `App.tsx` + `styles.css` + `tests/e2e/app.spec.ts`. Không đụng `docker/` ⇒ runner-images **KHÔNG** rebuild; chỉ frontend service rebuild + recreate.

**Verification:** `npm run typecheck` ✓, `npm test` ✓ 42 passed / 10 skipped, `npm run build -w @internal/frontend` ✓ (vite 1770 modules). E2E chưa chạy local (cần live server) — QC verify sau deploy: inspector hiện rõ bên phải (không cần kéo ngang mới thấy), boundingBox width>0 & trong viewport, kéo vạch 70/30 chỉnh width OK, double-click reset 30%, `documentElement.scrollHeight ≤ innerHeight` ở tab Debug.

## 2026-05-29 — Codex (session 3) — QC verify Claude session 20 debug layout

**Agent:** Codex QC
**Files Modified:**
- `ISSUES.md` — updated ISSUE-020/028/029 after live verification of Claude Code session 20; kept ISSUE-020/028 OPEN and marked ISSUE-029 PASSED.
- `LOG.md` — recorded this QC verification summary.
- `test-results/qc-session20-layout-overflow.png` — Playwright evidence screenshot for the right-panel offscreen regression.
- `test-results/qc-session20-variables-hidden.png` — Playwright evidence screenshot showing Variables data exists in DOM but the side panel has zero visible width/offscreen.

**Summary:** Reviewed Claude session 20 and verified the collapse toggle removal in source. Baseline `npm run typecheck` and `npm test` passed. Live e2e against `localhost:8080` failed 3/10 after the session-20 layout changes: the ISSUE-013 restart test timed out at status `Error`, the topbar debug-toolbar test timed out before breakpoint, and the side-panel test found `.debug-side-panel` hidden. Targeted Playwright probes reproduced the user report: when `isDebugActive`, `.editor-panel.debug-split` tries `7fr/3fr` but Monaco still consumes the full viewport width; the side panel is placed offscreen with `width=0`, page `scrollWidth` exceeds `clientWidth`, and users must horizontal-scroll to reach it. A C++ Variables probe showed `n=6` and `result=36` are present in the DOM, so the visible problem is layout width/overflow, not missing runner variable data.

**Deploy status:** No deploy — QC/test-only session. No product source changes.

**Verification:** `npm run typecheck` ✓, `npm test` ✓ 42 passed / 10 skipped, `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` ✗ 7/10, targeted Playwright layout probes reproduced ISSUE-028 and verified ISSUE-029 source removal.

## 2026-05-29 — Claude Code (session 20) — Debug layout redesign (ISSUE-028 + ISSUE-029, đóng ISSUE-020)

**Agent:** Claude Code
**Files Modified:**
- `apps/frontend/src/App.tsx` — (ISSUE-028) chuyển debug toolbar (6 nút, bỏ More dropdown) lên topbar, chỉ hiện khi `isDebugActive`, đặt vào khoảng trống giữa nút Stop và status pill. Tách editor thành `[Monaco 70% | panel phải 30%]` khi debug qua class `.editor-panel.debug-split` + `<aside className="debug-side-panel">`; panel phải có tabs chuyển đổi Variables/Call Stack/Watches (state `debugPanelTab`), tab Watches chứa luôn 2 form watch (Eval) + debug console (Send) chuyển từ dưới lên. Bottom tab Debug giờ chỉ còn `<TerminalView lines={debugConsole} />` (lớn như Output, bỏ `compact`). (ISSUE-029) bỏ hẳn collapse toggle: xoá state `isBottomCollapsed`, nút `.collapse-toggle`, dọn import `ChevronUp/ChevronDown/MoreHorizontal` + ref/effect của More menu; thêm effect gọi `editorRef.layout()` khi `isDebugActive` đổi.
- `apps/frontend/src/styles.css` — xoá `.workspace.bottom-collapsed`, `.collapse-toggle`, `.debug-grid`, `.inspectors`, `.debug-more*`. Thêm `.editor-panel.debug-split` (grid 7fr/3fr), `.debug-side-panel`/`.debug-side-tabs`/`.debug-side-body`. Restyle `.debug-toolbar` cho topbar (bỏ `width:max-content` + `margin:0 auto 10px`, dùng `margin-left:auto` + pill viên). Mobile (`max-width:860px`): `.editor-panel.debug-split { grid-template-columns: 1fr }` (panel xếp dọc).
- `tests/e2e/app.spec.ts` — cập nhật test ISSUE-010: bỏ assert nút "More"; đổi 2 test thành "toolbar ở topbar 6 nút (ISSUE-028)" + "right panel tabs Variables/Call Stack/Watches (ISSUE-028)".

**Summary:** Root cause ISSUE-028: toàn bộ nội dung debug (toolbar + console + 3 inspector + 2 form) bị nhồi vào `.result-card` trong bottom panel (~42% viewport) → terminal ép còn ~150px, document tràn xuống 1319px/960px. ISSUE-029: `.bottom-collapsed { grid-template-rows: 1fr 6px 0 }` zero hàng bottom làm tabbar bị clip. Hướng fix (user chốt qua grill): di chuyển inspector ra panel phải cạnh editor dạng tabs, toolbar lên topbar, bottom chỉ còn terminal lớn, bỏ collapse chỉ giữ resize. Phát hiện then chốt: runner đã tự emit `stack`+`variables` mỗi lần stop (`refreshStackAndVariables`) nên inspector luôn-hiện tự populate, More menu thành thừa → xoá.

**Deploy status:** Tự deploy khi push `main` (auto-deploy qua GitHub Actions — xem session 19). **Frontend-only**: `App.tsx` + `styles.css` + `tests/e2e/app.spec.ts`. Không đụng `docker/` ⇒ runner child images (cpp/python) **KHÔNG** rebuild; chỉ frontend service rebuild + recreate qua `docker compose up --build -d`.

**Verification:** `npm run typecheck` ✓, `npm test` ✓ 42 passed / 10 skipped, `npm run build -w @internal/frontend` ✓ (vite build 1770 modules OK). E2E chưa chạy local (cần live server) — QC verify sau deploy trên `localhost:8080`/tailnet: kỳ vọng toolbar ở topbar chỉ khi debug (6 nút), panel phải tabs populate khi dừng breakpoint, bottom Debug = terminal lớn, không còn collapse, và re-measure `documentElement.scrollHeight ≤ innerHeight` ở tab Debug (xác nhận đóng ISSUE-028).

## 2026-05-29 — Codex (session 2)

**Agent:** Codex
**Files Modified:**
- `ISSUES.md` — cập nhật QC verification sau Claude Code sessions 14-19; mark PASSED cho ISSUE-018/019/021/022/023/024/025/026/027, giữ ISSUE-016/017/020 OPEN, append ISSUE-028/029 từ bug UI/UX user report.
- `test-results/qc-debug-tab-layout.png` — Playwright evidence screenshot for ISSUE-028.
- `test-results/qc-collapse-hidden-tabs.png` — Playwright evidence screenshot for ISSUE-029.

**Summary:** Chạy QC sau khi user accept test cases. Baseline `npm run typecheck` PASS, `npm test` PASS 42/10. Live e2e `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` lần đầu flaky 7/9 (ISSUE-013 + ISSUE-010 debug-start assertions reached status Error) nhưng rerun PASS 9/9; ghi residual risk vào ISSUE-016 thay vì reopen product issues vì targeted probe sau đó pass. Docker-gated DAP integration vẫn FAIL 4/4 cả normal sandbox và escalated: C/C++ timed out compiling debug program, Python timed out waiting for adapter; giữ ISSUE-016 OPEN. User-reported UI bugs được verify bằng Playwright layout metrics: Debug tab làm document scrollHeight 1319px trên viewport 960px (ISSUE-028), collapse toggle che/clips bottom tabbar (ISSUE-029).

**Deploy status:** Không deploy — QC/test-only session, chỉ cập nhật docs/evidence. Không có source/runtime implementation changes.

**Verification:** `npm run typecheck` ✓, `npm test` ✓ 42 passed / 10 skipped, `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` first run 7/9 then rerun ✓ 9/9, `RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dapDebugSession.integration.test.ts --testTimeout=30000` ✗ 4/4 normal + escalated. Targeted Playwright verified gutter breakpoint count/Clear all, DEBUG_VERBOSE default hides benign diagnostics, Debug-tab overflow, and collapse hiding behavior.

## 2026-05-29 — Claude Code (session 19) — QUY TRÌNH DEPLOY MỚI (đọc trước khi QC)

**Agent:** Claude Code
**Files Modified:**
- Không sửa source — session ghi chú quy trình deploy mới cho QC

**⚠ THAY ĐỔI QUAN TRỌNG — Auto-deploy qua GitHub Actions thay cho WinSCP thủ công:**

User đã setup `.github/workflows/deploy.yml` (Auto Deploy). Từ nay quy trình deploy là:

1. **Deploy = `git push origin main`** (KHÔNG còn copy file qua WinSCP nữa).
2. Push lên `main` → self-hosted runner trên server tự chạy `bin/pull-latest.sh`:
   - `git pull --ff-only origin main`
   - Nếu có thay đổi trong `docker/` → `REBUILD_RUNNER_IMAGES=1` (rebuild cpp/python child images)
   - Luôn `RESTART_APP=1` → `docker compose up --build -d frontend api runner` (rebuild + recreate cả 3 service)
3. Workflow có `concurrency` (chặn deploy song song) + `timeout-minutes: 30`.

**Hệ quả cho các session trước:** Mọi mục **"Deploy status: copy ... qua WinSCP"** trong LOG sessions 8-18 nay **lỗi thời** — thay bằng: commit + push `main`, server tự rebuild. Quy tắc "không copy test file lên server" cũng không còn cần thiết (git pull cả repo; Dockerfiles không copy `tests/` vào image nên không ảnh hưởng build).

**Trạng thái deploy sessions 14-18 (UI/UX overhaul ISSUE-018→027 + ISSUE-026):**
- 5 file source/config thay đổi sẽ được deploy chung trong 1 commit push `main`:
  `apps/frontend/src/App.tsx`, `apps/frontend/src/styles.css`, `apps/runner/src/dapDebugSession.ts`, `docker-compose.yml`, `tests/e2e/app.spec.ts`.
- `docker/` KHÔNG đổi → runner child images (cpp/python) không rebuild; nhưng runner **service** image rebuild (lấy `dapDebugSession.ts` mới) và recreate với env `DEBUG_VERBOSE=0` mới từ compose.
- LOG.md gitignored → không vào commit (đúng kỳ vọng).

**QC verification flow mới (sau khi Action xanh):**
1. Theo dõi tab **Actions** → job "Auto Deploy" xanh (~2-3 phút) là server đã cập nhật.
2. Hard-reload (Ctrl+Shift+R) site → verify visual sessions 14-18.
3. `PLAYWRIGHT_BASE_URL=https://gdb.char-newton.ts.net npm run e2e` → kỳ vọng 9/9.
4. **2 rủi ro e2e cần để ý** (chưa verify được local vì cần server): (a) session 16 — 2 test mới dùng Monaco editing (badge + status-error); (b) session 18 — 4 test breakpoint với input `.sr-only`. Nếu fail thì áp fallback đã ghi trong LOG session 16/18.
5. ISSUE-026: verify console debug KHÔNG còn `[variables] no scopes`/`[stack] No frames`; nếu cần xem benign → set `DEBUG_VERBOSE=1` trong compose rồi redeploy.

**Deploy status:** N/A — session ghi chú quy trình.

**Verification:** N/A.

---

## 2026-05-29 — Claude Code (session 18)

**Agent:** Claude Code
**Files Modified:**
- `apps/frontend/src/App.tsx` — ISSUE-021 gutter breakpoints: đổi block label+input breakpoints visible thành `.breakpoint-info` chứa input `.sr-only` (GIỮ `id="breakpoints"` + `aria-label="breakpoints"` cho 4 e2e `getByLabel`), `.breakpoint-count` hiện "N breakpoints set — click the gutter to toggle", và "Clear all" button (`setBreakpointText("")`) khi count >0. Gutter click handler (onEditorMount) giữ nguyên làm primary UX
- `apps/frontend/src/styles.css` — thêm `.sr-only` utility (clip 1px, không display:none để Playwright vẫn fill được), `.breakpoint-info` (flex row), `.breakpoint-count` (`--text-secondary`), `.breakpoint-clear` (small button `--text-muted`)

**Summary:** Session 18 (gutter breakpoints) — session cuối của UI/UX overhaul. Input breakpoints chuyển sang sr-only (giữ trong DOM cho e2e + a11y thay vì xóa, theo leader constraint), gutter click trở thành primary UX với count display + Clear all. Hover preview (optional) SKIP để tránh Monaco repaint lag — document ở đây. Đối chiếu plan v2: UIUX-004 đúng (sr-only input, count + clear, gutter click giữ nguyên). Không lệch scope.

**Deploy status:** Pending — frontend-only, copy 2 files qua WinSCP:
- `apps/frontend/src/App.tsx`
- `apps/frontend/src/styles.css`

SSH: `docker compose up --build -d frontend`.

**Verification:**
- Local: `npm run typecheck` ✓ PASS, `npm test` ✓ 42/10, `grep hex` → 0
- Sau deploy: **`PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` ưu tiên** — 4 test `getByLabel("breakpoints").fill("6")` (lines 18/32/46/64) phải vẫn xanh với input sr-only. Nếu fail "not visible": fallback (a) thêm `force: true`, hoặc (b) đổi sr-only sang `position:absolute; left:-9999px`. Manual: click gutter line → dot đỏ toggle; count cập nhật; Clear all xoá hết; input breakpoints không hiện visible

**⚠ Lưu ý QC:** session 18 có rủi ro e2e sr-only chưa verify được local (cần server localhost:8080). Cần QC chạy e2e sau deploy để xác nhận 4 breakpoint test pass; nếu fail thì áp fallback trên.

---

## 2026-05-29 — Claude Code (session 17)

**Agent:** Claude Code
**Files Modified:**
- `apps/frontend/src/App.tsx` — ISSUE-020 resizable panels: import `ChevronUp`/`ChevronDown` + `type CSSProperties`; state `editorHeight`(58)/`isDragging`/`isBottomCollapsed` + `workspaceRef`; `startResize` callback (document mousemove throttle 16ms, clamp 20–85%, mouseup cleanup + `editorRef.current?.layout()` sau 50ms); chèn `.resize-handle` div giữa editor-panel và bottom-panel (`onMouseDown=startResize`, `onDoubleClick → reset 58`, collapse button toggle `isBottomCollapsed` với icon Chevron); `<main>` set `className` kèm `bottom-collapsed` + `ref={workspaceRef}` + `style` CSS var `--editor-height` (cast `as CSSProperties`)
- `apps/frontend/src/styles.css` — `.workspace` thêm `--editor-height: 58%` default; `@media (min-width: 861px)` set grid 3-row `minmax(200px, var(--editor-height)) 6px minmax(200px, 1fr)` + `.bottom-collapsed` → `1fr 6px 0`; `.resize-handle` (ns-resize, grip `::after`, hover/dragging → border-active), `.collapse-toggle` (absolute 24×24); mobile `max-width:860px` thêm `.resize-handle { display: none }`

**Summary:** Session 17 (resizable panels) theo plan. Kéo divider resize editor/bottom 20–85%, double-click reset 58%, collapse/expand bottom panel. Monaco re-layout explicit trên mouseUp (ngoài automaticLayout). Dùng CSS var `--editor-height` (không inline gridTemplateRows) để không override media query. **Điểm tích hợp leader:** breakpoint desktop dùng `861px` align với `max-width:860px` hiện có (thay 768px của v2) → tránh vùng overlap; mobile ẩn `.resize-handle` (display:none) để workspace còn 2 grid-item khớp 2-row mobile grid (desktop 3 item khớp 3-row). Đối chiếu plan v2: UIUX-003 đúng (CSS var, throttle 16ms, layout() on mouseUp, double-click reset, collapse) — chỉ khác breakpoint 861 (lý do trên). Không lệch scope.

**Deploy status:** Pending — frontend-only, copy 2 files qua WinSCP:
- `apps/frontend/src/App.tsx`
- `apps/frontend/src/styles.css`

SSH: `docker compose up --build -d frontend`.

**Verification:**
- Local: `npm run typecheck` ✓ PASS, `npm test` ✓ 42/10, `grep hex` → 0
- Sau deploy: kéo divider resize 20–85%; double-click reset 58%; collapse/expand bottom panel; Monaco editor re-layout đúng sau resize; mobile (≤860px) handle ẩn, layout không vỡ; `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` → 9/9 không regression

---

## 2026-05-29 — Claude Code (session 16)

**Agent:** Claude Code
**Files Modified:**
- `apps/frontend/src/App.tsx` — ISSUE-023: thêm icon vào 3 tab (`Terminal`→Output, `CircleX`→Error List, `Bug`→Debug) + `.tab-badge` hiện `diagnostics.length` khi >0. ISSUE-024: thêm `statusClass` useMemo (Idle→""/Starting→starting/Running→running/Exited 0→success/**Exited N≠0→error**/Error|Failed→error/Timed out→warning/Stopped→stopped/breakpoint→breakpoint) + apply vào status pill className reconcile với `running-long` (`status-pill ${statusClass}${... running-long}`)
- `apps/frontend/src/styles.css` — ISSUE-023: `.tab-badge` (pill đỏ `--color-error`, white text 11px/700). ISSUE-024: thêm `@keyframes fade-in-status` + 7 class `.status-starting/.status-running` (blue+pulse), `.status-success` (green), `.status-error` (red), `.status-warning`/`.status-breakpoint` (amber), `.status-stopped` (neutral) — đặt TRƯỚC `.status-pill.running-long` để running-long (specificity cao hơn) override khi run >3s. **Correction #2 giữ nguyên**: status-pill transition explicit từ session 15, KHÔNG dùng `transition: all`
- `tests/e2e/app.spec.ts` — thêm helper `replaceEditorSource` (Monaco edit qua keyboard) + 2 e2e: (1) ISSUE-023 compile error → `.tab-badge` visible với count >0; (2) ISSUE-024 `return 3` → status pill "Exited 3" + class `status-error`

**Summary:** Session 16 (tab icons + status colors) theo plan. ISSUE-023 thêm icon + error badge cho tab bar. ISSUE-024 status pill semantic colors với non-zero exit tô đỏ (fix từ leader review). Reconcile `running-long` (session 11 amber pulse cho run >3s) với `statusClass` mới: cả 2 cùng class nhưng `.status-pill.running-long` specificity cao hơn + đặt sau → amber thắng khi long-run, không xung đột. Correction #2 (bỏ transition:all) giữ nguyên. Đối chiếu plan v2: UIUX-006 + UIUX-007 đúng scope.

**Deploy status:** Pending — frontend-only, copy 2 files qua WinSCP:
- `apps/frontend/src/App.tsx`
- `apps/frontend/src/styles.css`

SSH: `docker compose up --build -d frontend`. (File test `app.spec.ts` KHÔNG copy.)

**Verification:**
- Local: `npm run typecheck` ✓ PASS, `npm test` ✓ 42/10, `grep hex` → 0
- Sau deploy: `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` → kỳ vọng 9 pass (7 cũ + 2 mới). Lưu ý 2 test mới dùng Monaco editor edit qua keyboard — nếu flaky trên CI thì QC tune timeout hoặc fallback manual. Manual: tab có icon, Error List có badge số khi compile lỗi, status pill đổi màu theo state (blue running, green Exited 0, red Exited N≠0/Error, amber breakpoint), long-run >3s vẫn amber pulse

---

## 2026-05-29 — Claude Code (session 15)

**Agent:** Claude Code
**Files Modified:**
- `apps/frontend/src/styles.css` — ISSUE-019 visual overhaul trên token base: (A) cards `.input-card/.result-card` glass-bg + shadow-md + focus-within glow; (B) buttons general thêm box-shadow + explicit transition + hover `translateY(-1px)`; **correction #1** explicit override `.debug-toolbar button:hover`/`.debug-more-menu button:hover` → `transform:none; box-shadow:none` (thay `:not()` descendant fragile); (C) Run button gradient + green glow halo; (D) `.tabbar button.selected::after` gradient underline; (E) topbar gradient bg + box-shadow viền; (F) status-pill glass (backdrop-filter, 1/2 element) + **correction #2** explicit transition (không `transition: all`); (G) inspector glass + hover; (H) terminal inset shadow; dropdown `.debug-more-menu` glass (2/2 element). ISSUE-022: thêm `.brand-icon` (gradient green→blue + glow + hover scale), `.brand-text` (fallback `--text-accent` + gradient clip), `h1.brand` reset
- `apps/frontend/src/App.tsx` — ISSUE-022: brand `<div>` → `<h1 className="brand">`, bọc icon trong `.brand-icon`, text trong `.brand-text` (Terminal size 20→18)

**Summary:** Session 15 (visual system + branding) theo plan. ISSUE-019 áp glassmorphism/gradient/micro-animation lên token foundation session 14, tuân thủ 3 safeguard v2: explicit transitions, glass blur chỉ 2 element (status-pill + debug-more-menu), exclude debug toolbar/dropdown buttons khỏi hover-lift (correction #1 dùng explicit override thay `:not()` fragile). Correction #2: status-pill transition explicit. ISSUE-022 header branding gradient icon + text với fallback color. Đối chiếu plan v2: đúng UIUX-002 A-H + UIUX-005, không lệch scope.

**Deploy status:** Pending — frontend-only, copy 2 files qua WinSCP:
- `apps/frontend/src/styles.css`
- `apps/frontend/src/App.tsx`

SSH: `docker compose up --build -d frontend` (không cần `--profile runner-images`).

**Verification:**
- Local: `npm run typecheck` ✓ PASS, `npm test` ✓ 42/10, `grep hex styles.css` → 0
- Sau deploy: cards có depth + shadow + focus glow; Run button gradient + glow; tab active underline gradient; topbar gradient; status pill glass; brand icon gradient + scale hover; brand text gradient (KHÔNG biến mất). **Kiểm `.debug-toolbar`/`.debug-more-menu` buttons KHÔNG translateY khi hover** (correction #1). `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` → 7/7 không regression

---

## 2026-05-29 — Claude Code (session 14)

**Agent:** Claude Code
**Files Modified:**
- `apps/frontend/src/styles.css` — ISSUE-018: rewrite toàn bộ với HSL design token system trong `:root` (layered bg, borders, text hierarchy, semantic colors, spacing/radius/shadow/glass/transition tokens); migrate cả 42 hex → token (grep xác nhận 0 hex còn lại). Áp depth hierarchy: app-shell=`--bg-base`, topbar/bottom=`--bg-layer-2`, cards/inspector=`--bg-layer-3`, buttons/inputs=`--bg-surface`, hover/dropdown=`--bg-elevated`, terminal=`--bg-terminal`. ISSUE-027: thêm `:focus-visible` outline + `:focus:not(:focus-visible)` suppress + override cho `.debug-toolbar button` (offset 1px) và `.tabbar button` (offset -2px)
- `apps/frontend/src/App.tsx` — ISSUE-025: thêm `disabled={!isRunActive && !isDebugActive}` cho topbar Stop button (CSS `button:disabled` đã có sẵn nên không cần thêm style)
- `apps/runner/src/dapDebugSession.ts` — ISSUE-026 (Option A): thêm field `private readonly verbose = process.env.DEBUG_VERBOSE === "1"`; gate 2 benign diagnostic (`[stack] No frames...` line 449, `[variables] no scopes...` line 489) sau `this.verbose`; GIỮ nguyên 3 error diagnostic (lines 485/512/550) luôn visible cho QC
- `docker-compose.yml` — ISSUE-026: thêm `DEBUG_VERBOSE: "0"` vào runner env để document default (benign ẩn cho user; QC set `=1` để xem)

**Summary:** Session 14 (foundation + bug fixes) theo implementation plan đã approve. ISSUE-018 design token system là nền tảng cho mọi visual change sau — migrate 42 hex sang HSL token, thêm depth hierarchy. ISSUE-027 focus-visible cho keyboard nav (mouse click không hiện outline). ISSUE-025 Stop button disabled khi idle. ISSUE-026 gate benign runner diagnostics sau `DEBUG_VERBOSE` (Option A runner-side đã được leader approve session 13), error diagnostics giữ nguyên. Đối chiếu plan v2 designer: đúng hướng, không lệch scope.

**Deploy status:** Pending — session này đụng runner (ISSUE-026) nên copy 3 source files + 1 config qua WinSCP:
- `apps/frontend/src/styles.css`
- `apps/frontend/src/App.tsx`
- `apps/runner/src/dapDebugSession.ts`
- `docker-compose.yml`

Sau đó SSH rebuild **runner + frontend**:
```
docker compose up --build -d runner frontend
```
(Không cần `--profile runner-images`.)

**Verification:**
- Local: `npm run typecheck` ✓ PASS, `npm test` ✓ 42 pass / 10 skip; `grep -E "#[0-9a-fA-F]{3,6}" styles.css` → 0 hex
- Sau deploy:
  - ISSUE-018: hard-reload, panels có depth phân biệt (topbar ≠ editor ≠ card ≠ terminal)
  - ISSUE-025: idle → Stop button xám (opacity 0.45, not-allowed); chạy → enabled
  - ISSUE-027: Tab key → focus ring xanh; mouse click → không outline
  - ISSUE-026: Debug session bình thường → console KHÔNG còn `[variables] no scopes`/`[stack] No frames`; deploy với `DEBUG_VERBOSE=1` → benign hiện lại; error diagnostic luôn hiện
  - `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` → 7/7 không regression

---

## 2026-05-28 — Claude Code (session 13)

**Agent:** Claude Code
**Files Modified:**
- Không sửa source code — session leader xác nhận plan v2 của designer

**Summary:** Review `implementation_plan.md` v2 (đã tích hợp 5 must-fix từ session 12 + verdict QC về UIUX-009). Verdict: **APPROVED — sẵn sàng implement**. Verify 5 must-fix: UIUX-002 ✓ (explicit transitions, glass giới hạn 2 element, exclude toolbar khỏi hover-lift), UIUX-003 ✓ (CSS var `--editor-height` + media query guard `min-width:768px` + throttle 16ms + `editor.layout()` on mouseUp + double-click reset), UIUX-004 ✓ (giữ input `.sr-only` thay vì xóa, e2e không cần đổi), UIUX-009 ✓ (Option A runner-side `DEBUG_VERBOSE` gate khuyến nghị, Option B frontend exact-regex fallback, 3 test cases), UIUX-007 ✓ (thêm nhánh `startsWith('Exited ')` cho non-zero exit). **2 nit nhỏ cần fix khi implement (không blocking):** (1) UIUX-002 selector `button:hover:not(.debug-toolbar button)` dùng descendant combinator trong `:not()` — chỉ chạy ở Chromium 88+ và fragile, nên thay bằng explicit override `.debug-toolbar button:hover { transform: none }`; (2) UIUX-007 `.status-pill { transition: all }` mâu thuẫn với rule "no transition: all" của UIUX-002 F (đã có explicit transition cho status-pill) — bỏ dòng `transition: all`. Sẽ tự sửa 2 nit này khi code. Quyết định: chọn UIUX-009 **Option A** (runner-side gate) làm primary.

**Deploy status:** Không deploy — approval session.

**Verification:** Không cần — leader approval. Implementation bắt đầu từ session 14 (session 13 này là approval, không trùng số implementation trong plan — plan đánh số 13-17 nhưng dịch +1 vì session 13 đã dùng cho approval).

---

## 2026-05-29 — Antigravity IDE (session 6)

**Agent:** Antigravity IDE
**Files Modified:**
- `ISSUES.md` — append 10 UIUX issues (ISSUE-018 → ISSUE-027) tương ứng UIUX-001 → UIUX-010 từ implementation plan v2 đã được Leader approved.
- `LOG.md` — ghi log session 6.

**Summary:** Leader (Claude Code) đã APPROVED plan v2 và ghi vào LOG.md. Antigravity IDE chuyển 10 item UI/UX vào ISSUES.md theo format chuẩn AGENTS.md, ký tên "Antigravity IDE", status "OPEN". Mapping: ISSUE-018 (UIUX-001 Design Tokens, High), ISSUE-019 (UIUX-002 Visual Overhaul, High), ISSUE-020 (UIUX-003 Resizable Panels, High), ISSUE-021 (UIUX-004 Gutter Breakpoints, High), ISSUE-022 (UIUX-005 Header Branding, Medium), ISSUE-023 (UIUX-006 Tab Icons, Medium), ISSUE-024 (UIUX-007 Status Animations, Medium), ISSUE-025 (UIUX-008 Stop Button, High), ISSUE-026 (UIUX-009 Debug Diagnostics, Medium), ISSUE-027 (UIUX-010 Focus Styles, Medium). Mỗi issue chứa đầy đủ steps to reproduce, expected/actual, evidence, discovery process, và suggested fix direction tham chiếu tới implementation_plan.md.

**Deploy status:** Không deploy — chỉ cập nhật ISSUES.md và LOG.md.

**Verification:** Không cần — chỉ là issue tracking session.

---

## 2026-05-28 — Antigravity IDE (session 5)

**Agent:** Antigravity IDE
**Files Modified:**
- `LOG.md` — ghi log session review verdict của QC và cập nhật implementation plan.
- `C:\Users\NNTruong\.gemini\antigravity\brain\0273b28a-bbd4-4ba5-b837-a1af44d5bca7\implementation_plan.md` — cập nhật các must-fix từ Leader review và 3 case test UIUX-009 từ QC verdict.

**Summary:** Review và verify Verdict của QC về UIUX-009. Xác nhận các thông tin QC cung cấp về runner diagnostics (lines 449, 489 cho benign; lines 485, 512, 550 cho error) và frontend forwarding (lines 96-98, 396-397) là hoàn toàn chính xác. Nhất trí với leader và QC không dùng frontend broad filter. Cập nhật `implementation_plan.md` phiên bản v2 tích hợp đầy đủ 5 must-fix revisions từ leader và hướng xử lý UIUX-009 (Option A và B) của QC. Copy các file ảnh screenshot từ subagent workspace sang current brain directory để giải quyết warning.

**Deploy status:** Không deploy — chỉ cập nhật plan và LOG.md.

**Verification:** Source code inspection (verified exact lines in `dapDebugSession.ts` and `App.tsx` match QC reports).

---

## 2026-05-28 — Codex (session 1)

**Agent:** Codex
**Files Modified:**
- `LOG.md` — append QC review/position for UIUX-009 diagnostic filtering discussion; no source implementation.

**Summary:** Review lại phản hồi của Claude Code (leader) và verification của Antigravity IDE về UIUX-009. Verdict của Codex QC: **đồng ý với leader/designer — không được filter thô `startsWith("[variables]")` ở frontend** vì frontend hiện forward toàn bộ `console` event vào debug console, còn runner đang emit cả benign diagnostics lẫn error diagnostics thật. Khuyến nghị implementation: xử lý ở runner-side bằng verbose gate/env flag cho benign messages (`[stack] No frames...`, `[variables] no scopes...`) và giữ các error diagnostics (`scopes frame=... error=...`, `scope=... error=...`, `fallback ... error=...`) luôn visible cho QC; frontend exact-regex filter chỉ nên là phương án dự phòng nếu buộc phải giữ scope frontend-only. Acceptance nên có test cho 3 case: default UI không bị spam benign diagnostic, error diagnostic vẫn hiện, và bật verbose mode thì benign diagnostic hiện lại cho QC.

**Deploy status:** Không deploy — chỉ cập nhật `LOG.md`, không có source/runtime changes và không cần `docker compose`.

**Verification:** Source inspection only. Verified `apps/runner/src/dapDebugSession.ts` emits benign diagnostics at lines 449/489 and real error diagnostics at lines 485/512/550; verified `apps/frontend/src/App.tsx` forwards `console` events directly via `appendDebug` at lines 96-98 and 396-397, so frontend broad filtering would hide real runner errors.

## 2026-05-28 — Antigravity IDE (session 4)

**Agent:** Antigravity IDE
**Files Modified:**
- Không sửa source code — session verify phản hồi của Claude Code (leader) session 12

**Summary:** Verify 5 must-fix points từ Claude Code session 12 review bằng cách cross-reference với source code thực tế. Kết quả: **tất cả 5 điểm đều ĐÚNG**, leader review rất chính xác. (1) UIUX-002: xác nhận `transition: all` anti-pattern, `backdrop-filter` 7+ elements gây jank, `translateY(-1px)` đụng debug toolbar session 11 — sửa plan: explicit transitions, glass chỉ 2 element, scope trừ toolbar; (2) UIUX-003: xác nhận inline `gridTemplateRows` override media query line 502-504, Monaco `automaticLayout: true` tại line 566 — sửa plan: CSS custom property thay inline style, throttle drag, bổ sung double-click reset; (3) UIUX-004: xác nhận 4 e2e tests dùng `getByLabel("breakpoints").fill("6")` tại lines 18/32/46/64 — sửa plan: giữ input dạng visually-hidden (sr-only); (4) UIUX-009: xác nhận 3/5 `[variables]` messages là error diagnostics thật (lines 485/512/550), filter `startsWith` ở frontend sẽ giấu lỗi — rút khỏi scope frontend-only, đề xuất 2 option cho leader; (5) UIUX-007: xác nhận non-zero exit code (`Exited 1`, `Exited 137`) rơi vào `return ''` — sửa plan thêm nhánh `startsWith('Exited ')`. Verified cả 4 should-fix: UIUX-001 scope thật = 42 unique hex / 58 occurrences (High complexity), UIUX-008 CSS disabled đã có sẵn line 50-53, UIUX-005 cần fallback color, session 11 colors chưa tokenize.

**Deploy status:** Không deploy — verification session, không có source changes.

**Verification:** Không cần — verification/response session.

---

## 2026-05-28 — Claude Code (session 12)

**Agent:** Claude Code
**Files Modified:**
- Không sửa source code — session review/duyệt plan UI/UX của Antigravity IDE (designer), không implement

**Summary:** Review plan `implementation_plan.md` (UIUX-001 → UIUX-010) của designer. Verdict: **APPROVE WITH REVISIONS** — plan có cấu trúc tốt, scope đúng (2 frontend files, no backend), dependency graph + session split hợp lý, có acceptance criteria. Verify từng claim với codebase: (1) UIUX-001 underestimate scope — thực tế 42 unique hex / 63 occurrences, không phải "20+", complexity nên là High không phải Medium; (2) UIUX-008 đúng — topbar Stop [App.tsx:539](apps/frontend/src/App.tsx#L539) thiếu `disabled`, và CSS `button:disabled` đã có sẵn (styles.css:50-53) nên fix chỉ cần thêm prop; (3) UIUX-004 gutter handler đã tồn tại [App.tsx:446-453](apps/frontend/src/App.tsx#L446-L453) đúng như plan nói. **Các must-fix trước khi implement:** UIUX-002 (`transition: all` anti-pattern + backdrop-filter quá nhiều element gây jank + hover-lift đụng debug toolbar session 11); UIUX-003 (inline `gridTemplateRows` override media query mobile line 502 + Monaco `automaticLayout` cần `editor.layout()` explicit); UIUX-004 (4 e2e test dùng `getByLabel("breakpoints")` — Monaco gutter click trong Playwright rất flaky → khuyến nghị GIỮ input dạng visually-hidden thay vì xóa hẳn); UIUX-009 (`[variables]`/`[stack]` đến từ runner diagnostic ISSUE-006 — filter ở frontend sẽ giấu cả error thật, nên gate ở runner-side, bàn với QC); UIUX-007 (non-zero exit code không được tô màu). Đã gửi feedback chi tiết về cho designer.

**Deploy status:** Không deploy — review session, không có source changes.

**Verification:** Không cần — review/approval session. Implementation sẽ ở các session sau (Claude Code session 13+) sau khi designer revise plan theo feedback.

---

## 2026-05-28 — Antigravity IDE (session 3)

**Agent:** Antigravity IDE
**Files Modified:**
- Không sửa source code — session này chỉ review UI/UX và lên plan

**Summary:** Review UI/UX toàn diện cho trang web https://gdb.char-newton.ts.net/ thông qua browser testing (18 screenshots, Lighthouse audit: Accessibility 100, Best Practices 100, SEO 75). Chấm điểm tổng 7.75/10. Tiến hành grill-me interview với user để xác định scope: (1) đối tượng sử dụng = personal tool trên Tailscale, (2) layout = VS Code-style resizable panels, (3) visual = glassmorphism + gradients + micro-animations, (4) workflow = gutter breakpoints, (5) branding = nâng cấp header nhưng giữ tên, (6) colors = HSL-based design tokens, (7) scope bổ sung = tab icons + status animations + bug fixes. Tạo implementation plan chi tiết 10 items (UIUX-001 → UIUX-010) phân 3 tier, đề xuất chia 5 sessions cho Claude Code thực hiện. Plan pending Claude Code (leader) review.

**Deploy status:** Không deploy — không có source code thay đổi.

**Verification:** Không cần — chỉ là plan/review session.

---

## 2026-05-27 — Claude Code (session 11)

**Agent:** Claude Code
**Files Modified:**
- `apps/frontend/src/App.tsx` — redo ISSUE-010 visual layout theo image VS Code Insiders user gửi: (1) Continue/Pause là 1 button toggle slot (Pause khi `isDebugRunning`, Continue khi `isDebugStopped`, disabled khi neither); (2) thêm Restart button với `handleRestart` callback (gửi stop → đợi 200ms cho server cleanup theo ISSUE-013 → gọi `startDebug` lại với state hiện tại, dùng `startDebugRef` ref để tránh circular dependency); (3) thêm More (⋯) menu button với `aria-haspopup="menu"` + `aria-expanded`, click-toggle dropdown `.debug-more-menu` chứa Variables + Call Stack items có labels; (4) `isMoreMenuOpen` state + `moreMenuRef` + useEffect click-outside listener đóng menu; (5) layout 7 buttons visible thay vì 8: [Continue/Pause toggle] [Step Over] [Step Into] [Step Out] [Restart] [Stop] [⋯]; import `MoreHorizontal` từ lucide-react
- `apps/frontend/src/styles.css` — đổi `.icon-stop` từ #e51400 sang #f48771 (VS Code Insiders red); thêm `.debug-more` (position relative) và `.debug-more-menu` (dropdown panel: absolute top-100%+6px, dark bg #252526, border #3c3c3c, shadow, min-width 160px, z-index 10); `.debug-more-menu button` (icon+label horizontal, height 28px, transparent bg, hover overlay 10%, disabled opacity 0.5)
- `tests/e2e/app.spec.ts` — test #6 cập nhật cho toggle pattern (Pause không render khi stopped, `toHaveCount(0)` thay vì `toBeDisabled()`; thêm assert Restart/More buttons enabled); thay test #7 từ "exposes visible groups and VS Code icons" thành "matches VS Code Insiders layout" — verify 7 visible buttons, icon-only (innerText rỗng), 7 aria-labels (Continue/Step over/Step into/Step out/Restart/Stop/More), click More mở `.debug-more-menu` chứa text "Variables" và "Call Stack"

**Summary:** Redo ISSUE-010 visual theo image VS Code Insiders user gửi. User reject layout Antigravity session 2 (Continue + Pause song song, không có Restart, Variables/Stack visible) vì không khớp VS Code Insiders. Layout mới: 7 buttons với Continue/Pause toggle (1 slot), Restart (NEW client-side stop→delay→startDebug), Variables/Stack di chuyển vào dropdown More (⋯) menu. Reuse `handleStop` và `startDebug` cho Restart, không cần backend changes.

ISSUE-016 verification: phát hiện patches session 10 ĐÃ CÓ trong `apps/runner/src/dapDebugSession.integration.test.ts` (verify bằng grep: `PER_TEST_TIMEOUT_MS = 45_000` line 10, `summarizeEvent` function line 136, `Date.now()` clientIds, `Promise.race` cleanup). Codex's 21:48 + 22:06 "missing session 10 patches" có khả năng là source-review nhìn vào server file deployment (test files KHÔNG deploy per CLAUDE.md convention) hoặc local checkout stale. Claude không thể tự verify trên Windows native vì không có `/var/run/docker.sock` — cần Codex pull source mới nhất từ workspace rồi rerun `RUN_DOCKER_TESTS=1 npm test`.

**Deploy status:** Pending — copy 2 source files lên server qua WinSCP:
- `apps/frontend/src/App.tsx`
- `apps/frontend/src/styles.css`

(File test `tests/e2e/app.spec.ts` KHÔNG copy lên server.) Sau đó SSH rebuild:
```
docker compose up --build -d frontend
```
(Không cần `--profile runner-images`.)

**Verification:**
- Local: `npm run typecheck` ✓ PASS, `npm test` ✓ 42 pass / 10 skip
- Sau deploy:
  - ISSUE-010 visual: Hard-reload (Ctrl+Shift+R), Debug session → toolbar phải có 7 nút khớp VS Code Insiders image, click More (⋯) → dropdown hiện Variables + Call Stack, click Restart → session restart sau ~200ms; `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` → 7/7 (test #6 + #7 updated)
  - ISSUE-016: QC cần pull source mới và chạy `RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dapDebugSession.integration.test.ts` — kỳ vọng 4/4 pass trong < 3 phút với per-test timeout 45s; nếu Python fail có thể thử `DAP_PYTHON_STARTUP_MS=15000`

---

## 2026-05-27 — Antigravity IDE (session 2)

**Agent:** Antigravity IDE
**Files Modified:**
- `apps/frontend/src/App.tsx` — implement visual design cho debug toolbar dùng VS Code Insiders icons (lucide-react: Play, Pause, SkipForward, ArrowDownToLine, vv.) và chia nhóm `.debug-group` (fix ISSUE-010 visual)
- `apps/frontend/src/styles.css` — thêm styling cho `.debug-toolbar` (floating bar, padding, dark background) và `.debug-group` (fix ISSUE-010 visual)
- `tests/e2e/app.spec.ts` — update regression test #7 (thay vì `.fixme` check text labels, chuyển thành test check icon-only styling và aria-labels đúng ý muốn của user) (fix ISSUE-010 visual)

**Summary:** Bỏ `.fixme` khỏi test #7 và implement visual design cho debug toolbar (ISSUE-010). Thiết kế icon-only, nhóm thành `.debug-group`, CSS dạng floating bar giống style của Visual Studio Insiders. Cập nhật Playwright test để verify icon-only styling và aria-labels.

**Deploy status:** Pending — copy 2 source files lên server qua WinSCP:
- `apps/frontend/src/App.tsx`
- `apps/frontend/src/styles.css`

(File test `tests/e2e/app.spec.ts` KHÔNG copy lên server.) Sau đó SSH rebuild:
```
docker compose up --build -d
```
(Không cần `--profile runner-images`.)

**Verification:**
- Local: `npm run typecheck` ✓ PASS, `npm test` ✓ 42 pass / 10 skip
- Sau deploy cần verify:
  - ISSUE-010 visual: `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` (test #7 `debug toolbar exposes visible groups and VS Code icons` phải pass)

---

## 2026-05-27 — Claude Code (session 10)

**Agent:** Claude Code
**Files Modified:**
- `apps/runner/src/dapDebugSession.ts` — `waitForDebugAdapterReady` cho Python đọc `DAP_PYTHON_STARTUP_MS` env (default `5000`) để cho phép QC tăng timeout khi chạy integration test trên dev WSL2 (fix ISSUE-016 Layer 4)
- `apps/runner/src/dapDebugSession.integration.test.ts` — Layer 1 (per-test `{ timeout: 45_000 }` thay vì dựa vào vitest default 5s), Layer 2 (diagnostic message khi internal 25s timeout fire: in tên + summary tất cả `collected` events), Layer 3 (cleanup race `Promise.race([session.close, 10s hard cap])` để worker không bị treo nếu close hang), Layer 4 (clientId unique mỗi run dùng `Date.now()` để tránh collision khi rerun). Helper mới `summarizeEvent` để chuẩn hóa diagnostic output (fix ISSUE-016)
- `apps/frontend/src/App.tsx` — thêm 2 derived value `isDebugRunning` / `isDebugStopped` từ `isDebugActive` + `debugStatus`; áp dụng `disabled` cho 8 debug toolbar buttons theo state (Continue/Step/Variables/Stack: enable khi stopped; Pause: enable khi running; Stop: enable khi active) (fix ISSUE-010 scaffolding — phần functional logic)
- `tests/e2e/app.spec.ts` — thêm 2 e2e test cho ISSUE-010: (1) `debug toolbar disables step controls when not stopped (scaffolding)` verify functional disabled state đã hoạt động (passing); (2) `test.fixme(...exposes visible labels and groups)` document acceptance criteria cho visual design — Antigravity IDE bỏ `.fixme` khi implement xong

**Summary:** Fix ISSUE-016 và prepare scaffolding cho ISSUE-010. ISSUE-016 root cause là vitest test-level timeout (default 5s) cắt trước internal 12s timeout của `debugUntilStopped` — fix 4 layer: per-test timeout 45s + diagnostic on timeout + cleanup race + unique clientId + configurable Python adapter timeout (env override). ISSUE-010: tách phần FUNCTIONAL (disabled state logic dựa trên debug status — Claude Code làm) khỏi phần VISUAL (labels, grouping, styling — Antigravity IDE thiết kế); regression test scaffolding test.fixme document acceptance criteria.

**Deploy status:** Pending — copy 2 source files lên server qua WinSCP:
- `apps/runner/src/dapDebugSession.ts`
- `apps/frontend/src/App.tsx`

(2 file test `dapDebugSession.integration.test.ts` và `tests/e2e/app.spec.ts` KHÔNG copy lên server.) Sau đó SSH rebuild:
```
docker compose up --build -d runner frontend
```
(Không cần `--profile runner-images`.)

**Verification:**
- Local: `npm run typecheck` ✓ PASS, `npm test` ✓ 42 pass / 10 skip
- Sau deploy:
  - ISSUE-016: `RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dapDebugSession.integration.test.ts` — kỳ vọng 4 pass trong < 3 phút; nếu Python fail có thể thử `DAP_PYTHON_STARTUP_MS=15000 RUN_DOCKER_TESTS=1 npm test -- ...Python`; verify không leftover container (`docker ps` sau test phải sạch)
  - ISSUE-010 scaffolding: `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` — kỳ vọng 6 pass + 1 fixme (`exposes visible labels and groups`); Manual: trong Debug session, Pause button phải gray khi stopped at breakpoint, Continue/Step phải gray sau khi click Continue (status → Running)
  - ISSUE-010 visual: chờ Antigravity IDE — khi xong, Antigravity bỏ `test.fixme` thành `test` và làm pass test thứ 7

---

## 2026-05-27 — Antigravity IDE (session 1)

**Agent:** Antigravity IDE
**Files Modified:**
- `apps/runner/src/dapDebugSession.ts` — thêm `onCloseStart` callback vào constructor, gọi synchronous ở đầu `close()` trước mọi async work (fix ISSUE-013); thêm `MemorySwap: this.config.memoryBytes` vào container HostConfig (fix ISSUE-015)
- `apps/runner/src/debugSession.ts` — mirror thay đổi ISSUE-013 (`onCloseStart`) và ISSUE-015 (`MemorySwap`) cho MI debug engine
- `apps/runner/src/app.ts` — tách `onClose` callback thành `onCloseStart` (clear `debugByClient` + `debugSessions` synchronous) và `onClose` (release job slot cuối) (fix ISSUE-013)
- `apps/runner/src/dockerRunner.ts` — thêm `MemorySwap: this.config.memoryBytes` vào run container HostConfig (fix ISSUE-015)
- `docker-compose.yml` — đổi `RUN_TIMEOUT_MS: "30000"` → `"15000"` (fix ISSUE-014)
- `apps/runner/src/config.ts` — đổi default `runTimeoutMs` từ `30000` → `15000` (fix ISSUE-014)
- `apps/frontend/src/App.tsx` — thêm `runElapsed` state + `useEffect` timer khi `isRunActive`; status pill hiển thị `Running Xs…` với CSS class `running-long` khi run > 3s (fix ISSUE-014)
- `apps/frontend/src/styles.css` — thêm `@keyframes pulse-status` animation và `.status-pill.running-long` style (amber color + pulse) (fix ISSUE-014)
- `apps/runner/src/dapDebugSession.integration.test.ts` — cập nhật `DapDebugSession` constructor call từ 5 → 6 arguments (theo ISSUE-013 refactor)

**Summary:** Fix 3 OPEN issues. ISSUE-013: root cause là `debugByClient.delete()` chỉ chạy ở cuối async `session.close()` — sau `dap.disconnect()`, `container.remove()`, `rm workspace` — nên immediate re-POST thấy stale entry → 409. Fix: tách `onClose` thành `onCloseStart` (synchronous, chạy ngay khi `close()` bắt đầu) xóa `debugByClient`/`debugSessions` trước mọi async cleanup; `onClose` chỉ còn `releaseJobSlot`. ISSUE-014: giảm timeout 30s → 15s, thêm animated elapsed timer trên status pill khi run > 3s. ISSUE-015: thêm `MemorySwap = Memory` chặn swap extension trên tất cả container types (run, debug DAP, debug MI).

**Deploy status:** Pending — copy 7 source files lên server qua WinSCP:
- `apps/runner/src/app.ts`
- `apps/runner/src/dapDebugSession.ts`
- `apps/runner/src/debugSession.ts`
- `apps/runner/src/dockerRunner.ts`
- `apps/runner/src/config.ts`
- `apps/frontend/src/App.tsx`
- `apps/frontend/src/styles.css`

KHÔNG copy file test (`dapDebugSession.integration.test.ts`) và config (`docker-compose.yml`) lên server — `docker-compose.yml` cần sửa trực tiếp trên server hoặc copy riêng. Sau đó SSH rebuild:
```
docker compose up --build -d
```
(Không cần `--profile runner-images` — chỉ TypeScript + React + config thay đổi, không đụng `docker/runner-*/`.)

Lưu ý riêng: `docker-compose.yml` **cũng cần copy lên server** vì đổi `RUN_TIMEOUT_MS`. Sau khi copy xong chạy:
```
docker compose up --build -d
```

**Verification:**
- Local: `npm run typecheck` ✓ PASS, `npm test` ✓ 42 pass / 10 skip
- Sau deploy cần verify:
  - ISSUE-013 TC-010: Debug → breakpoint → topbar Stop → Debug lại ngay (< 500ms) → phải đạt breakpoint, không 409
  - ISSUE-014 TC-017: Infinite loop C → timeout ~15-20s, status pill animated khi > 3s
  - ISSUE-015 TC-018: 2GB malloc C → output KHÔNG chứa `unexpected: wrote`
  - `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` (tất cả test phải pass)

---

## 2026-05-27 — Claude Code (session 9)

**Agent:** Claude Code
**Files Modified:**
- `apps/runner/src/app.ts` — `/debug/:id` WS `close` handler giờ vừa `unsubscribe()` vừa `void session.close(false)` (fix ISSUE-013 core): khi browser/topbar đóng controlling socket, runner tự terminate `DapDebugSession`, giải phóng `debugByClient[clientId]` và job slot → POST `/debug` lần kế tiếp cùng clientId không còn 409. `close()` đã idempotent nên an toàn nếu user dùng toolbar Stop button trước (gửi `stop` command rồi WS close sau)
- `apps/frontend/src/App.tsx` — `handleStop` gửi `JSON.stringify({ type: "stop" })` qua `debugSocket.current` (nếu OPEN) trước `stopSockets()` để runner có shutdown sequence rõ ràng (defense-in-depth bổ trợ cho server-side fix); thêm `data-testid="btn-topbar-stop"` cho topbar Stop button để e2e test target rõ ràng
- `tests/e2e/app.spec.ts` — regression test mới `topbar Stop allows starting Debug again without reload (ISSUE-013)`: set breakpoint `6`, Debug → đợi `breakpoint`/`Stopped`, topbar Stop → đợi `Stopped`, Debug lần 2 → đợi `breakpoint`/`Stopped` (không reload page); test sẽ fail nếu bug tái xuất hiện (lần 2 sẽ thấy `Failed` thay vì `breakpoint`)

**Summary:** Fix ISSUE-013 — topbar Stop trước đây chỉ đóng WebSocket client-side, runner chỉ unsubscribe events mà không close `DapDebugSession`, để lại `debugByClient[clientId]` lingering cho đến `DEBUG_MAX_MS`/`DEBUG_IDLE_MS` timeout → POST `/debug` lần kế tiếp cùng clientId trả 409. Root cause server-side: WS close handler không gọi `session.close()`. Fix combined: (1) runner WS close → idempotent `session.close(false)` bao quát mọi disconnect path (Stop, reload, tab close, network drop); (2) frontend gửi `stop` command trước khi đóng socket cho graceful shutdown. Không sửa `dapDebugSession.ts` (`close()` đã idempotent từ trước).

**Deploy status:** Pending — copy 2 source files lên server qua WinSCP:
- `apps/runner/src/app.ts`
- `apps/frontend/src/App.tsx`

(File test `tests/e2e/app.spec.ts` KHÔNG copy lên server.) Sau đó SSH rebuild runner + frontend:
```
docker compose up --build -d runner frontend
```
(Không cần `--profile runner-images` — chỉ TypeScript + React, không đụng `docker/runner-*/`.)

**Verification cần làm sau deploy:**
- Local: `npm run typecheck` (✓ PASS), `npm test` (✓ 42 pass / 10 skip)
- Local e2e sau deploy: `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e` (4 test cũ + 1 test mới = 5/5)
- Manual TC-010 trên `http://localhost:8080` (hard-reload Ctrl+Shift+R), cho cả C, C++, Python: stdin `6`, breakpoint hợp lệ → Debug đạt `breakpoint` → topbar Stop → trạng thái `Stopped` + debug console `Stopped by user` → click Debug lần 2 không reload → đạt `breakpoint`/`Stopped`, KHÔNG thấy `Failed` hay 409
- API/WebSocket probe (tùy chọn): POST `/api/debug` 2 lần liên tiếp cùng `clientId`, mở/đóng WS ở giữa → cả 2 lần đều trả 202

---

## 2026-05-27 — Claude Code (session 8)

**Agent:** Claude Code
**Files Modified:**
- `apps/runner/src/dapDebugSession.ts` — bỏ `start: 0, count: 100` trên `variables` request và bỏ `supportsVariablePaging: true` (GDB 14 DAP ném `IndexError: list index out of range` trên paged path → bubble lên debug console nhưng watch vẫn OK vì dùng `evaluate`); thêm flag `stopped` track stopped/continue/step để `refreshVariables` chỉ chạy khi frame còn valid; per-scope try/catch để 1 scope fail không xóa cả panel; helper mới `fetchVariablesViaInfoLocals(frameId)` fallback cho C/C++ khi DAP trả về 0 variables — evaluate `info args`/`info locals` qua REPL rồi parse; export `parseInfoLocals(output)` (pure function) có brace-depth tracking để giá trị struct multi-line `{ x = 1, y = 2 }` không bị parse thành biến top-level
- `apps/runner/src/dapDebugSession.test.ts` — file mới, 7 unit tests cho `parseInfoLocals` (simple pairs, `No locals.`/`No arguments.`, empty, struct multi-line, pointer-with-string, whitespace tolerance)
- `apps/runner/src/dapDebugSession.integration.test.ts` — thêm 2 regression test (C và C++) gated bởi `RUN_DOCKER_TESTS=1`, mirror TC-001/TC-002: stdin `6`, breakpoint sau `result = n*n`, assert event `variables` cuối cùng chứa `{ name: "n", value: "6" }` và `{ name: "result", value: "36" }`

**Summary:** Fix ISSUE-006 round 2 — sau session 7 vẫn fail vì root cause thực không phải `expensive` flag mà là GDB 14 DAP có bug trong handler `variables` khi nhận paged request. Fix 3 layer: (1) bỏ paging client-side, (2) per-scope error isolation + diagnostic chi tiết (`scope=… ref=… error=…`), (3) fallback `info locals`/`info args` cho C/C++ nếu DAP vẫn trả rỗng. Python không đụng tới (ISSUE-007 đã PASSED). Watches không thay đổi vì đã dùng `evaluate` (đường khác trong GDB DAP, đã hoạt động). ISSUE-013/014/015 hoãn lại theo yêu cầu user.

**Deploy status:** Pending — copy 1 file `apps/runner/src/dapDebugSession.ts` lên server qua WinSCP, sau đó SSH rebuild:
```
docker compose up --build -d
```
(Không cần rebuild runner images — chỉ TypeScript thay đổi, không sửa script Docker)

**Verification cần làm sau deploy:**
- Local: `npm test -- apps/runner/src/dapDebugSession.test.ts` (✓ 7/7 đã pass), `npm run typecheck` (✓ đã pass)
- Docker-gated: `docker compose --profile runner-images build runner-cpp-image runner-python-image && RUN_DOCKER_TESTS=1 npm test -- apps/runner/src/dapDebugSession.integration.test.ts`
- Manual UI: TC-001 (C++) và TC-002 (C) — stdin `6`, breakpoint sau gán `result`, click Debug → Variables panel hiển thị `n = 6` và `result = 36` tự động, không cần bấm Eval

---

## 2026-05-27 — Claude Code (session 7)

**Agent:** Claude Code  
**Files Modified:**
- `apps/runner/src/dapDebugSession.ts` — bỏ `!scope.expensive` khỏi C/C++ scope filter (fix ISSUE-006 root cause: GDB 14.x có thể mark Locals scope là `expensive: true` → bị lọc ra); thêm diagnostic trong `catch` block của `refreshVariables` để emit lỗi thực ra debug console thay vì silent; thêm diagnostic khi `stackTrace` trả về frames rỗng

**Summary:** Fix ISSUE-006 (C/C++ Variables panel = 0). Root cause: session 5/6 đều giữ lại `!scope.expensive` trong filter — nếu GDB 14.x mark Locals scope `expensive: true`, scope bị loại trước khi fetch variables. Fix: `!scope.expensive` chỉ còn áp dụng cho Python (whitelist `local|argument`); C/C++ chỉ blacklist Registers. Thêm 2 diagnostic để QC có thể đọc lý do nếu vẫn fail.

**Deploy status:** Pending — copy 1 file lên server qua WinSCP, sau đó SSH rebuild:
```
docker compose up --build -d
```
(Không cần rebuild runner images — chỉ TypeScript thay đổi)

---

## 2026-05-27 — Claude Code (session 6)

**Agent:** Claude Code  
**Files Modified:**
- `apps/runner/src/dapDebugSession.ts` — đổi scope filter sang language-specific: C/C++ blacklist `^register` thay vì whitelist `^(local|argument)` (fix ISSUE-006); thêm variable-level filter loại bỏ `special variables`/`function variables`/`class variables` (fix ISSUE-007 Bug A); thêm Python frame filter chỉ giữ frames có source trong `/workspace/` (fix ISSUE-007 Bug B)
- `apps/frontend/src/App.tsx` — thêm `setIsRunActive(false)`/`setIsDebugActive(false)` vào argv catch và fetch catch của `startRun`/`startDebug` (fix ISSUE-012); thêm `aria-label` cho tất cả debug toolbar buttons (fix ISSUE-010)

**Summary:** Fix 4 issues: C/C++ Variables panel vẫn empty sau stdin fix (scope filter quá restrictive); Python Variables bị nhiễu special/function variables và Call Stack lộ internal Python frames; invalid argv giữ buttons disabled mãi; debug toolbar buttons thiếu aria-label.

**Deploy status:** Pending — copy 2 files lên server qua WinSCP, sau đó SSH rebuild:
```
docker compose up --build -d
```
(Không cần rebuild runner images — chỉ TypeScript và frontend thay đổi)

---

## 2026-05-27 — Claude Code (session 5)

**Agent:** Claude Code  
**Files Modified:**
- `docker/runner-cpp/debug-dap-c` — thêm GDB `exec-wrapper` via `--init-command` để redirect inferior stdin từ `/workspace/stdin.txt` (fix ISSUE-006)
- `docker/runner-cpp/debug-dap-cpp` — như trên (fix ISSUE-006)
- `apps/runner/src/dapDebugSession.ts` — null `this.dap` sau `close()` để guard hậu-close commands; filter scopes bằng `/^(local|argument)/i` thay `slice(0,3)` để loại bỏ Globals/Special Variables (fix ISSUE-007)
- `apps/frontend/src/App.tsx` — thêm `isRunActive`/`isDebugActive` state để disable Run/Debug buttons khi session active (fix ISSUE-011); `handleStop` với feedback "Stopped by user" (fix ISSUE-009); validate breakpoints vs `getLineCount()` trong `startDebug()` và filter decorations (fix ISSUE-008)

**Summary:** Fix 4 issues: C/C++ inferior stdin đọc DAP bytes thay vì stdin.txt; Python debug variables bị nhiễu; breakpoints out-of-range không bị reject; Stop button không có feedback; Run/Debug buttons không disabled khi session active.

**Deploy status:** Pending — copy 4 files lên server qua WinSCP, sau đó SSH rebuild:
```
docker compose --profile runner-images build runner-cpp-image
docker compose up --build -d
```

---

## 2026-05-27 — Claude Code (session 4)

**Agent:** Claude Code  
**Files Modified:**
- `tests/e2e/app.spec.ts` — đổi debug session assertion từ `/Ready|compile/` → `/breakpoint|Stopped/i` (fix ISSUE-005)

**Summary:** Fix e2e test `opens a C++ debug session` bị fail vì assertion sai. `"compile"` không bao giờ là giá trị của `.status-pill` (nó chỉ trigger appendDebug, không setDebugStatus). `"Ready"` là trạng thái transient bị miss. Trạng thái terminal đúng khi GDB dừng tại breakpoint là `"breakpoint"` (từ DAP `stopped` event với `reason: "breakpoint"`).

**Deploy status:** Không cần deploy lên server — chỉ sửa test file, chạy E2E locally: `PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run e2e`

---

## 2026-05-27 — Claude Code (session 3)

**Agent:** Claude Code  
**Files Modified:**
- `apps/api/src/app.ts` — thêm `isBinary` flag vào cả 2 `message` handlers trong `proxyWebSocket` để preserve WebSocket frame type (fix ISSUE-004)

**Summary:** Fix debug WebSocket bị stuck ở "Starting" do API proxy forward text frames từ runner dưới dạng binary frames. `ws` library deliver text frames vào callback dưới dạng `Buffer`; không có `{ binary: isBinary }`, `client.send(Buffer)` auto-send binary frame → browser nhận `Blob` → `JSON.parse("[object Blob]")` fails. Fix: truyền `isBinary` từ upstream callback vào `send()` options.

**Deploy status:** Pending — copy `apps/api/src/app.ts` lên server qua WinSCP, sau đó SSH chạy: `cd /opt/apps/GDB_ubuntu && docker compose up --build -d api`

---

<!-- Format: mỗi session = 1 entry, mới nhất ở trên -->
<!-- Agent: Claude Code / Codex / Antigravity IDE / Human -->

## 2026-05-27 — Claude Code (session 2)

**Agent:** Claude Code  
**Files Modified:**
- `docker/runner-cpp/run-c` — thay `bc` bằng `printf "%d.%03d"` để tính elapsed_seconds (fix ISSUE-001)
- `docker/runner-cpp/run-cpp` — như trên
- `docker/runner-python/run-python` — như trên
- `apps/frontend/src/App.tsx` — thêm `data-testid="btn-debug"` vào toolbar Debug button (fix ISSUE-002b)
- `tests/e2e/app.spec.ts` — fix expectations (`Hello, World`→`Hello World`, `6`→`Hello World`), đổi tên test Python, dùng `getByTestId("btn-debug")` thay `getByRole("button", { name: "Debug" })` (fix ISSUE-002a + 002b)

**Summary:** Fix 3 issues từ Codex QC: loại bỏ dependency `bc` khỏi runner scripts bằng pure shell arithmetic; sửa stale E2E test expectations khớp với default snippets thực tế; disambiguate toolbar Debug button khỏi Debug tab button bằng `data-testid`.

**Deploy status:** Pending — cần copy 5 files lên server qua WinSCP, sau đó chạy `RESTART_APP=1 REBUILD_RUNNER_IMAGES=1 bash bin/pull-latest.sh`

---

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
