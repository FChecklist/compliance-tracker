// R74 Y4-04: a Playwright fixture per role, reading credentials from the
// git-ignored .env.r74-test.local (never committed, never hard-coded here).
// Built on the 8 accounts created and login-verified in R74 Phase 3
// (claude_log id 207): 2 tenants x 4 roles (admin, manager, member,
// external_auditor).
import { test as base, type Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ path: path.resolve(__dirname, "../../.env.r74-test.local") });

export type R74Role = "ADMIN" | "MANAGER" | "MEMBER" | "EXTERNAL_AUDITOR";
export type R74Tenant = "A" | "B";

function credsFor(tenant: R74Tenant, role: R74Role) {
  const email = process.env[`R74_TEST_${tenant}_${role}_EMAIL`];
  const password = process.env[`R74_TEST_${tenant}_${role}_PASSWORD`];
  if (!email || !password) {
    throw new Error(
      `R74 test credentials missing for tenant ${tenant} role ${role} -- ` +
        `.env.r74-test.local not loaded, or R74 Phase 3's accounts were never created/were deleted.`
    );
  }
  return { email, password };
}

/** Logs a page in as the given tenant+role via the real login form (not an API shortcut -- GY-11/KY-15: UI requirements need a browser run, not a manufactured session). */
export async function loginAs(page: Page, tenant: R74Tenant, role: R74Role) {
  const { email, password } = credsFor(tenant, role);
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

// One fixture-extended `test` per role -- import the one matching the brief,
// e.g. `import { adminTest as test } from "./fixtures/r74-roles"`.
function makeRoleTest(tenant: R74Tenant, role: R74Role) {
  return base.extend<{ loggedInPage: Page }>({
    loggedInPage: async ({ page }, use) => {
      await loginAs(page, tenant, role);
      await use(page);
    },
  });
}

export const tenantAAdminTest = makeRoleTest("A", "ADMIN");
export const tenantAManagerTest = makeRoleTest("A", "MANAGER");
export const tenantAMemberTest = makeRoleTest("A", "MEMBER");
export const tenantAExternalAuditorTest = makeRoleTest("A", "EXTERNAL_AUDITOR");
export const tenantBAdminTest = makeRoleTest("B", "ADMIN");
export const tenantBManagerTest = makeRoleTest("B", "MANAGER");
export const tenantBMemberTest = makeRoleTest("B", "MEMBER");
export const tenantBExternalAuditorTest = makeRoleTest("B", "EXTERNAL_AUDITOR");
