import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken } from "../apps/web/lib/auth/jwt";

describe("JWT auth", () => {
  it("creates and verifies a valid token", async () => {
    const token = await createSessionToken({ sub: "user-1", email: "test@example.com", org_id: "org-1", role: "editor", full_name: "Test User" });
    expect(typeof token).toBe("string");
    const payload = await verifySessionToken(token);
    expect(payload?.sub).toBe("user-1");
    expect(payload?.email).toBe("test@example.com");
    expect(payload?.role).toBe("editor");
  });

  it("returns null for invalid token", async () => {
    const payload = await verifySessionToken("invalid.token.here");
    expect(payload).toBeNull();
  });
});