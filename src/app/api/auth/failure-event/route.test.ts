/// <reference types="bun-types" />
// DOD-C8 fix (2026-09-10): before this, an unparseable body, a missing
// email, or an unrecognized method ALL returned { ok: true } and never
// called recordAuthFailureAndCheckAnomaly -- a credential-stuffing script
// hitting this endpoint directly (not through the real client) could send
// exactly such a body every time and suppress the repeated-failed-auth
// signal entirely, indistinguishable from a real logged event. This test
// proves: (a) a malformed/unattributable request now gets a non-ok
// response and never reaches the recorder, (b) a well-formed request still
// reaches the recorder and still gets a generic { ok: true } -- the
// anti-enumeration property (never reveal whether the email matched a real
// account) is unaffected for real client traffic.
import { describe, expect, test, mock, beforeEach } from "bun:test";

let recordCalls: Array<{ email: string; method: string; ipAddress: string | undefined }>;

mock.module("@/lib/services/auth-failure-service", () => ({
  isValidAuthFailureMethod: (value: string) => ["password", "oauth", "sso", "passcode"].includes(value),
  recordAuthFailureAndCheckAnomaly: async (params: { email: string; method: string; ipAddress?: string }) => {
    recordCalls.push({ email: params.email, method: params.method, ipAddress: params.ipAddress });
  },
}));

function makeRequest(rawBody: string | object): Request {
  const body = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);
  return new Request("http://localhost/api/auth/failure-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

beforeEach(() => {
  recordCalls = [];
});

describe("POST /api/auth/failure-event -- DOD-C8 fail-open fix", () => {
  test("unparseable JSON body: 400, recorder never called", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("{not json"));
    expect(res.status).toBe(400);
    expect(recordCalls).toHaveLength(0);
  });

  test("valid JSON, missing email: 400, recorder never called", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ method: "password" }));
    expect(res.status).toBe(400);
    expect(recordCalls).toHaveLength(0);
  });

  test("valid JSON, unrecognized method (the exact credential-stuffing evasion this closes): 400, recorder never called", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ email: "victim@example.com", method: "not-a-real-method" }));
    expect(res.status).toBe(400);
    expect(recordCalls).toHaveLength(0);
  });

  test("well-formed request: recorder IS called with the real email/method/ip, response is still the same generic { ok: true } (anti-enumeration property unaffected)", async () => {
    const { POST } = await import("./route");
    const req = makeRequest({ email: "victim@example.com", method: "password" });
    Object.defineProperty(req, "headers", {
      value: new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0]).toEqual({ email: "victim@example.com", method: "password", ipAddress: "203.0.113.5" });
  });

  test("a well-formed request whose email does NOT match any real account still returns the identical { ok: true } -- never reveals account existence", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ email: "definitely-not-a-real-user@example.com", method: "password" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(recordCalls).toHaveLength(1);
  });
});
