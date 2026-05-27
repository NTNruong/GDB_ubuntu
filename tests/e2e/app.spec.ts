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
