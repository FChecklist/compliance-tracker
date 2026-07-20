/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { BOTTOM_NAV_ITEMS, isBottomNavActive, bottomNavLabelKey } from "./bottom-nav-items";

describe("V2-2 bottom-nav-items -- design law conformance", () => {
  test("the law's 6 items are present, in the law's stated order", () => {
    expect(BOTTOM_NAV_ITEMS.map((i) => i.lawKey)).toEqual([
      "chat",
      "todo",
      "analytics",
      "approval",
      "email",
      "new",
    ]);
  });

  test("every item maps to a real existing app route (no dangling hrefs)", () => {
    const hrefs = BOTTOM_NAV_ITEMS.map((i) => i.href);
    expect(hrefs).toEqual(["/chat", "/home", "/dashboard", "/approvals", "/tasks", "/compliance"]);
    // Email/New are honestly reconciled to existing routes, not /email or /new
    // (which don't exist as routes yet) -- see bottom-nav-items.ts header.
    expect(hrefs).not.toContain("/email");
    expect(hrefs).not.toContain("/new");
  });

  test("every href is a non-empty absolute app path", () => {
    for (const item of BOTTOM_NAV_ITEMS) {
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.href.length).toBeGreaterThan(1);
    }
  });
});

describe("isBottomNavActive -- matches the kit sidebar's active rule", () => {
  test("exact match is active", () => {
    expect(isBottomNavActive("/chat", "/chat")).toBe(true);
  });

  test("nested route under an item is active (prefix branch)", () => {
    expect(isBottomNavActive("/compliance?status=overdue", "/compliance")).toBe(false);
    expect(isBottomNavActive("/compliance/123", "/compliance")).toBe(true);
    expect(isBottomNavActive("/tasks/abc", "/tasks")).toBe(true);
  });

  test("unrelated route is not active", () => {
    expect(isBottomNavActive("/dashboard", "/chat")).toBe(false);
    expect(isBottomNavActive("/home", "/tasks")).toBe(false);
  });

  test("a href that is a substring but not a path segment is not active", () => {
    // /home must not light up the /hom... prefix of an unrelated longer route
    expect(isBottomNavActive("/homepage", "/home")).toBe(false);
  });

  test("null/undefined pathname is never active", () => {
    expect(isBottomNavActive(null, "/chat")).toBe(false);
    expect(isBottomNavActive(undefined, "/chat")).toBe(false);
  });
});

describe("bottomNavLabelKey", () => {
  test("produces the Nav.bottomNav.<lawKey> i18n path", () => {
    expect(bottomNavLabelKey({ lawKey: "chat", href: "/chat" })).toBe("Nav.bottomNav.chat");
    expect(bottomNavLabelKey({ lawKey: "new", href: "/compliance" })).toBe("Nav.bottomNav.new");
  });
});
