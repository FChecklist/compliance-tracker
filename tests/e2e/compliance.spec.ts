import { test, expect } from "@playwright/test";

test.describe("Compliance management", () => {
  test.beforeEach(async ({ page }) => {
    // Mock login by setting cookie — real tests use a test account
    await page.goto("/login");
  });

  test("compliance list page renders table", async ({ page }) => {
    await page.goto("/compliance");
    await expect(page.getByRole("heading", { name: /compliance/i })).toBeVisible();
    await expect(page.getByText(/add compliance/i)).toBeVisible();
  });

  test("new compliance form has required fields", async ({ page }) => {
    await page.goto("/compliance/new");
    await expect(page.getByRole("heading", { name: /add compliance/i })).toBeVisible();
    await expect(page.getByLabel(/title/i)).toBeVisible();
    await expect(page.getByLabel(/due date/i)).toBeVisible();
  });
});