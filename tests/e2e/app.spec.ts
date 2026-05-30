import { expect, test } from "@playwright/test";

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  const stop = page.getByTestId("btn-topbar-stop");
  const visible = await stop.isVisible({ timeout: 500 }).catch(() => false);
  if (!visible) return;
  await stop.click().catch(() => undefined);
  await page
    .waitForFunction(
      () => {
        const pill = document.querySelector(".status-pill")?.textContent ?? "";
        return /Stopped|Exited|Idle|Ready|Timed out|Error/i.test(pill);
      },
      { timeout: 5_000 }
    )
    .catch(() => undefined);
});

test("runs a C++ hello world snippet", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.locator(".terminal")).toContainText("Hello World", { timeout: 30_000 });
});

test("requires a breakpoint before debugging", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText("No breakpoints");
  await expect(page.locator(".terminal")).toContainText("No breakpoints set. Add a breakpoint before starting debug.");
});

test("opens a C++ debug session", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("breakpoints").fill("6");
  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText(/breakpoint|Stopped/i, { timeout: 30_000 });
});

test("runs Python hello world", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Language").selectOption("python");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.locator(".terminal")).toContainText("Hello World", { timeout: 30_000 });
});

test("topbar Stop allows starting Debug again without reload (ISSUE-013)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("breakpoints").fill("6");

  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText(/breakpoint|Stopped/i, { timeout: 30_000 });

  await page.getByTestId("btn-topbar-stop").click();
  await expect(page.locator(".status-pill")).toContainText("Stopped");

  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText(/breakpoint|Stopped/i, { timeout: 30_000 });
});

test("debug toolbar disables step controls when not stopped (ISSUE-010 scaffolding)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("breakpoints").fill("6");
  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText(/breakpoint|Stopped/i, { timeout: 30_000 });

  // When stopped at breakpoint: Continue/Step/Restart/Stop enabled; Pause is hidden (toggle replaced by Continue)
  await expect(page.locator('.debug-toolbar button[aria-label="Continue"]')).toBeEnabled();
  await expect(page.locator('.debug-toolbar button[aria-label="Step over"]')).toBeEnabled();
  await expect(page.locator('.debug-toolbar button[aria-label="Restart"]')).toBeEnabled();
  await expect(page.locator('.debug-toolbar button[aria-label="Stop"]')).toBeEnabled();
  // Pause button should not be rendered while stopped (toggle pattern)
  await expect(page.locator('.debug-toolbar button[aria-label="Pause"]')).toHaveCount(0);
});

// ISSUE-028: the debug control toolbar lives in the topbar (only while debugging),
// icon-only, 6 buttons (no More dropdown — Variables/Call Stack are now right-panel tabs).
test("debug toolbar lives in the topbar with 6 icon buttons (ISSUE-028)", async ({ page }) => {
  await page.goto("/");
  // Not visible before a debug session starts
  await expect(page.locator(".debug-toolbar")).toHaveCount(0);

  await page.getByLabel("breakpoints").fill("6");
  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText(/breakpoint|Stopped/i, { timeout: 30_000 });

  // Toolbar appears inside the topbar header
  await expect(page.locator("header .debug-toolbar")).toBeVisible();

  // 6 buttons: Continue (toggle slot), Step Over, Step Into, Step Out, Restart, Stop
  await expect(page.locator(".debug-toolbar > .debug-group > button")).toHaveCount(6);

  // Each button is icon-only (no inline text)
  const toolbarButtonText = await page.locator(".debug-toolbar > .debug-group > button").allInnerTexts();
  for (const text of toolbarButtonText) {
    expect(text.trim()).toBe("");
  }

  // Accessibility: each button has aria-label; no More button
  for (const label of ["Continue", "Step over", "Step into", "Step out", "Restart", "Stop"]) {
    await expect(page.locator(`.debug-toolbar button[aria-label="${label}"]`)).toBeVisible();
  }
  await expect(page.locator('.debug-toolbar button[aria-label="More"]')).toHaveCount(0);
});

// ISSUE-028: Variables / Call Stack are switchable tabs in a right-side
// panel beside the editor, populated automatically on stop.
// Watches are stacked below Variables in the same tab.
test("debug side panel shows switchable Variables/Call Stack tabs with stacked Watches (ISSUE-028)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("breakpoints").fill("6");
  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText(/breakpoint|Stopped/i, { timeout: 30_000 });

  const panel = page.locator(".debug-side-panel");
  await expect(panel).toBeVisible();

  // ISSUE-028 regression guard: panel must have real width and sit inside the
  // viewport (session 20 bug pushed it to width=0 / off-screen).
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(120);
  expect(box!.x + box!.width).toBeLessThanOrEqual((viewport?.width ?? 0) + 2);

  // ISSUE-028 v3 guard: editor + bottom must stay inside the left workspace column,
  // not blow out to full viewport and cover the inspector (session 21 residual:
  // .workspace=1114 but .editor-panel/.bottom-panel=1600).
  const ws = await page.locator(".workspace").boundingBox();
  const ep = await page.locator(".editor-panel").boundingBox();
  const bp = await page.locator(".bottom-panel").boundingBox();
  expect(ep!.width).toBeLessThanOrEqual(ws!.width + 2);
  expect(bp!.width).toBeLessThanOrEqual(ws!.width + 2);
  // editor must not overlap the right inspector panel
  expect(ep!.x + ep!.width).toBeLessThanOrEqual(box!.x + 2);
  // no document-level horizontal overflow
  const overflowX = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflowX).toBeLessThanOrEqual(2);

  // Tab bar has exactly 2 buttons (Variables, Call Stack) — no Watches tab
  await expect(panel.locator(".debug-side-tabs button")).toHaveCount(2);

  // Variables tab is default and selected
  await expect(panel.locator(".debug-side-tabs button.selected")).toContainText("Variables");

  // Watch + debug console inputs are reachable from the Variables tab (stacked below)
  await expect(panel.locator('input[placeholder="watch"]')).toBeVisible();
  await expect(panel.locator('input[placeholder="debug console"]')).toBeVisible();

  // Switch to Call Stack
  await panel.getByRole("button", { name: "Call Stack" }).click();
  await expect(panel.locator(".debug-side-tabs button.selected")).toContainText("Call Stack");
});

// ISSUE-030: C/C++ program stdout must reach the Debug terminal (by end of session).
// The inferior previously inherited gdb's fd1 (the DAP channel) so printf output was lost.
test("debug terminal shows C program stdout (ISSUE-030)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Language").selectOption("c");
  await replaceEditorSource(
    page,
    `#include <stdio.h>\n\nint main() {\n  int arr[] = {1, 3, 5, 7, 9};\n  int *p = arr;\n  int n = sizeof(arr) / sizeof(arr[0]);\n  for (int i = 0; i < n; i++) {\n    printf("%d ", *(p + i));\n  }\n  return 0;\n}\n`
  );
  await page.getByLabel("breakpoints").fill("5");
  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText(/breakpoint|Stopped/i, { timeout: 30_000 });

  // Continue to completion: the program prints "1 3 5 7 9" then exits.
  await page.locator('.debug-toolbar button[aria-label="Continue"]').click();
  await expect(page.locator(".status-pill")).toContainText(/Exited/i, { timeout: 30_000 });

  // Program stdout must be visible in the Debug terminal (not just compile + exit messages).
  await page.locator(".tabbar button", { hasText: "Debug" }).click();
  await expect(page.locator(".terminal")).toContainText("1 3 5 7 9", { timeout: 10_000 });
});

// ISSUE-032: stepping past the end of main must not hang the session in "Running".
// When a step lands outside all user frames, the runner auto-continues to exit so
// the program terminates cleanly and its stdout is flushed.
test("step over past end of main exits cleanly (ISSUE-032)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Language").selectOption("c");
  await replaceEditorSource(
    page,
    `#include <stdio.h>\n\nint main() {\n  int arr[] = {1, 3, 5, 7, 9};\n  int *p = arr;\n  int n = sizeof(arr) / sizeof(arr[0]);\n  for (int i = 0; i < n; i++) {\n    printf("%d ", *(p + i));\n  }\n  return 0;\n}\n`
  );
  await page.getByLabel("breakpoints").fill("11");
  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText(/breakpoint|Stopped/i, { timeout: 30_000 });

  // Step over repeatedly past main's return; the session must reach Exited, not hang in Running.
  const stepOver = page.locator('.debug-toolbar button[aria-label="Step over"]');
  for (let i = 0; i < 6; i++) {
    if (await page.locator(".status-pill").innerText().then((t) => /Exited/i.test(t))) {
      break;
    }
    if (await stepOver.isEnabled()) {
      await stepOver.click();
    }
    await page.waitForTimeout(700);
  }
  await expect(page.locator(".status-pill")).toContainText(/Exited/i, { timeout: 30_000 });

  await page.locator(".tabbar button", { hasText: "Debug" }).click();
  await expect(page.locator(".terminal")).toContainText("1 3 5 7 9", { timeout: 10_000 });
});

// ISSUE-031: C arrays must be inspectable — the collapsed row shows a bounded summary
// and clicking the caret lazily reveals the elements.
test("C array variable shows a summary and expands to elements (ISSUE-031)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Language").selectOption("c");
  await replaceEditorSource(
    page,
    `#include <stdio.h>\n\nint main() {\n  int arr[] = {1, 3, 5, 7, 9};\n  int *p = arr;\n  int n = sizeof(arr) / sizeof(arr[0]);\n  for (int i = 0; i < n; i++) {\n    printf("%d ", *(p + i));\n  }\n  return 0;\n}\n`
  );
  await page.getByLabel("breakpoints").fill("8");
  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText(/breakpoint|Stopped/i, { timeout: 30_000 });

  const panel = page.locator(".debug-side-panel");
  // Variables tab is the default; the arr row shows a bounded summary value.
  const arrRow = panel.locator(".var-row", { hasText: "arr" }).first();
  await expect(arrRow).toBeVisible({ timeout: 10_000 });
  await expect(arrRow.locator("code")).toContainText("1");

  // Expanding reveals the array elements lazily.
  await arrRow.locator(".var-caret").click();
  await expect(panel.locator(".var-row", { hasText: "[0]" })).toBeVisible({ timeout: 10_000 });
});

// ISSUE-031: watches must re-evaluate on every stop (not keep the Eval-time value)
// and be removable via the per-row × button.
test("watches refresh on step and can be removed (ISSUE-031)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Language").selectOption("c");
  await replaceEditorSource(
    page,
    `#include <stdio.h>\n\nint main() {\n  int arr[] = {1, 3, 5, 7, 9};\n  int *p = arr;\n  int n = sizeof(arr) / sizeof(arr[0]);\n  for (int i = 0; i < n; i++) {\n    printf("%d ", *(p + i));\n  }\n  return 0;\n}\n`
  );
  await page.getByLabel("breakpoints").fill("8");
  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText(/breakpoint|Stopped/i, { timeout: 30_000 });

  const panel = page.locator(".debug-side-panel");
  // Watches are now visible under the Variables tab (stacked layout) — no tab click needed
  await panel.locator('input[placeholder="watch"]').fill("i");
  await panel.locator('input[placeholder="watch"]').press("Enter");

  const watchValue = panel.locator(".watch-row", { hasText: "i" }).locator("code");
  await expect(watchValue).toHaveText("0", { timeout: 10_000 });

  // Step over within the loop: i goes 0 -> 1; the watch must update automatically.
  const stepOver = page.locator('.debug-toolbar button[aria-label="Step over"]');
  for (let n = 0; n < 6; n++) {
    if (await watchValue.innerText().then((text) => text.trim() === "1").catch(() => false)) {
      break;
    }
    if (await stepOver.isEnabled()) {
      await stepOver.click();
    }
    await page.waitForTimeout(500);
  }
  await expect(watchValue).toHaveText("1", { timeout: 10_000 });

  // The × button removes the watch row.
  await panel.locator(".watch-row", { hasText: "i" }).locator(".watch-remove").click();
  await expect(panel.locator(".watch-row", { hasText: "i" })).toHaveCount(0);
});

// ISSUE-035: the watch + debug console submit buttons were removed; Enter-to-submit
// must still work, and no visible submit buttons should remain.
test("watch + debug console inputs submit via Enter with no visible buttons (ISSUE-035)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("breakpoints").fill("6");
  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText(/breakpoint|Stopped/i, { timeout: 30_000 });

  const panel = page.locator(".debug-side-panel");
  await expect(panel.locator('.debug-form button[type="submit"]')).toHaveCount(0);

  // The watch input must fill its form (no leftover ~200px intrinsic width gap),
  // and focusing it must not push horizontal overflow at the panel or document level.
  const watchInput = panel.locator('input[placeholder="watch"]');
  await watchInput.focus();
  const inputBox = await watchInput.boundingBox();
  const formBox = await panel.locator(".debug-form").first().boundingBox();
  expect(inputBox).not.toBeNull();
  expect(formBox).not.toBeNull();
  expect(inputBox!.width).toBeGreaterThanOrEqual(formBox!.width - 2);
  const panelOverflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(panelOverflow).toBeLessThanOrEqual(2);
  const docOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(docOverflow).toBeLessThanOrEqual(2);

  // Enter on the watch input must still register a watch.
  await watchInput.fill("42");
  await watchInput.press("Enter");
  await expect(panel.locator(".watch-row", { hasText: "42" })).toBeVisible({ timeout: 10_000 });
});

async function replaceEditorSource(page: import("@playwright/test").Page, source: string) {
  // Use Monaco's setValue via the window hook installed in onEditorMount — keystroke
  // replacement is unreliable (auto-bracket pairing on insertText leaves stale `}` chars).
  await page.locator(".monaco-editor").first().waitFor();
  await page.waitForFunction(() => Boolean((window as unknown as { __monacoEditor?: unknown }).__monacoEditor));
  await page.evaluate((src) => {
    const editor = (window as unknown as { __monacoEditor?: { setValue: (value: string) => void } }).__monacoEditor;
    editor?.setValue(src);
  }, source);
}

// Stacked layout regression: Variables and Watches visible simultaneously under the Variables tab,
// with a vertical resize handle between them.
test("Variables and Watches are stacked with a resize handle under the Variables tab", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("breakpoints").fill("6");
  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText(/breakpoint|Stopped/i, { timeout: 30_000 });

  const panel = page.locator(".debug-side-panel");
  await expect(panel).toBeVisible();

  // Both sections visible at the same time under the Variables tab
  await expect(panel.locator(".debug-variables-section")).toBeVisible();
  await expect(panel.locator(".debug-watches-section")).toBeVisible();

  // The resize handle is present between them
  await expect(panel.locator(".debug-vsplit")).toBeVisible();

  // Tab bar shows only 2 buttons
  await expect(panel.locator(".debug-side-tabs button")).toHaveCount(2);
});

test("Error List tab shows badge with diagnostic count on compile error (ISSUE-023)", async ({ page }) => {
  await page.goto("/");
  await replaceEditorSource(page, "int main() { this is not valid c++ }\n");
  await page.getByRole("button", { name: "Run" }).click();
  // Compile error auto-switches to Error List tab and populates diagnostics
  await expect(page.locator(".tab-badge")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".tab-badge")).not.toHaveText("0");
});

test("non-zero exit colors status pill red (ISSUE-024)", async ({ page }) => {
  await page.goto("/");
  await replaceEditorSource(page, "int main() { return 3; }\n");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.locator(".status-pill")).toContainText("Exited 3", { timeout: 30_000 });
  await expect(page.locator(".status-pill")).toHaveClass(/status-error/);
});

// ISSUE-017: a warning-only compile must NOT steal focus to the Error List; it stays on
// Output, finishes with a warning count, and the badge is yellow (warning), not red.
test("warning-only compile stays on Output with a warning count (ISSUE-017)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Language").selectOption("c");
  await replaceEditorSource(page, "int main() {\n  int unused;\n  return 0;\n}\n");
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.locator(".status-pill")).toContainText("Exited 0", { timeout: 30_000 });
  // Output tab keeps focus (no auto-switch on warnings) and shows the warning count.
  await expect(page.locator(".tabbar button", { hasText: "Output" })).toHaveClass(/selected/);
  await expect(page.locator(".terminal")).toContainText(/Finished, \d+ Warning/);
  // The Error List badge is present and yellow (warning severity), not red.
  await expect(page.locator(".tab-badge")).toHaveClass(/tab-badge-warning/);
});
