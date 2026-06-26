import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("register page accessible", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: /create your organisation/i })).toBeVisible();
    await expect(page.getByPlaceholder(/organisation name/i)).toBeVisible();
  });

  test("login links to register", async ({ page }) => {
    await page.goto("/login");
    await page.getByText(/register your organisation/i).click();
    await expect(page).toHaveURL(/\/register/);
  });
});