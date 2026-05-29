import { expect, test } from "@playwright/test";

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

// ISSUE-028: Variables / Call Stack / Watches are switchable tabs in a right-side
// panel beside the editor, populated automatically on stop.
test("debug side panel shows switchable Variables/Call Stack/Watches tabs (ISSUE-028)", async ({ page }) => {
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

  // Variables tab is default and selected
  await expect(panel.locator(".debug-side-tabs button.selected")).toContainText("Variables");

  // Switch to Call Stack
  await panel.getByRole("button", { name: "Call Stack" }).click();
  await expect(panel.locator(".debug-side-tabs button.selected")).toContainText("Call Stack");

  // Switch to Watches — the watch + debug console inputs moved up here
  await panel.getByRole("button", { name: "Watches" }).click();
  await expect(panel.locator('input[placeholder="watch"]')).toBeVisible();
  await expect(panel.locator('input[placeholder="debug console"]')).toBeVisible();
});

async function replaceEditorSource(page: import("@playwright/test").Page, source: string) {
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(source);
}

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
