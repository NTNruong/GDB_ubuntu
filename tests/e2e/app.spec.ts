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
  await expect(page.locator('.debug-toolbar button[aria-label="More"]')).toBeEnabled();
  // Pause button should not be rendered while stopped (toggle pattern)
  await expect(page.locator('.debug-toolbar button[aria-label="Pause"]')).toHaveCount(0);
});

// ISSUE-010 visual: VS Code Insiders-style 7-button layout with More (⋯) dropdown
// containing Variables and Call Stack actions. Icon-only with aria-label/title.
test("debug toolbar matches VS Code Insiders layout (ISSUE-010)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("breakpoints").fill("6");
  await page.getByTestId("btn-debug").click();
  await expect(page.locator(".status-pill")).toContainText(/breakpoint|Stopped/i, { timeout: 30_000 });

  // 7 visible toolbar buttons: Continue (toggle slot), Step Over, Step Into, Step Out, Restart, Stop, More
  await expect(page.locator(".debug-toolbar > .debug-group > button")).toHaveCount(7);

  // Each visible button is icon-only (no inline text in main toolbar)
  const toolbarButtonText = await page.locator(".debug-toolbar > .debug-group > button").allInnerTexts();
  for (const text of toolbarButtonText) {
    expect(text.trim()).toBe("");
  }

  // Accessibility: each button has aria-label
  for (const label of ["Continue", "Step over", "Step into", "Step out", "Restart", "Stop", "More"]) {
    await expect(page.locator(`.debug-toolbar button[aria-label="${label}"]`)).toBeVisible();
  }

  // More menu opens and reveals Variables / Call Stack items
  await page.locator('.debug-toolbar button[aria-label="More"]').click();
  await expect(page.locator('.debug-more-menu')).toBeVisible();
  await expect(page.locator('.debug-more-menu')).toContainText("Variables");
  await expect(page.locator('.debug-more-menu')).toContainText("Call Stack");
});
