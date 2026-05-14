import { expect, test } from "@playwright/test";

test("runs a C++ hello world snippet", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.locator(".terminal")).toContainText("Hello, World", { timeout: 30_000 });
});

test("opens a C++ debug session", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Debug" }).click();
  await expect(page.locator(".status-pill")).toContainText(/Ready|compile/, { timeout: 30_000 });
});

test("runs Python with numpy", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Language").selectOption("python");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.locator(".terminal")).toContainText("6", { timeout: 30_000 });
});
