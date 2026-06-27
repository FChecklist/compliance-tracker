import { describe, it, expect } from "vitest";
import { hasPermission, canManageUser } from "../apps/web/lib/auth/rbac";

describe("RBAC", () => {
  it("account_admin can manage all compliance", () => {
    expect(hasPermission("account_admin", "compliance", "create")).toBe(true);
    expect(hasPermission("account_admin", "compliance", "delete")).toBe(true);
    expect(hasPermission("account_admin", "users", "manage")).toBe(true);
  });

  it("viewer cannot create compliance", () => {
    expect(hasPermission("viewer", "compliance", "create")).toBe(false);
    expect(hasPermission("viewer", "compliance", "delete")).toBe(false);
  });

  it("editor can create but not delete compliance", () => {
    expect(hasPermission("editor", "compliance", "create")).toBe(true);
    expect(hasPermission("editor", "compliance", "delete")).toBe(false);
  });

  it("account_admin can manage viewer", () => {
    expect(canManageUser("account_admin", "viewer")).toBe(true);
    expect(canManageUser("viewer", "account_admin")).toBe(false);
  });
});