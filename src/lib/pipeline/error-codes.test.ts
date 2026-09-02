/// <reference types="bun-types" />
// R67 lane B (B-01 / D-03). The whole point of this module is that nothing
// user-facing ever leaves this repo, so the tests assert the ABSENCE of
// prose as hard as they assert the presence of codes.
import { describe, expect, test } from "bun:test";
import {
  PIPELINE_ERROR_CODES,
  codeForParam,
  failureLogLine,
  isTransportErrorMessage,
  normaliseThrownError,
  parseFailure,
  pipelineFailure,
  serialiseFailure,
} from "./error-codes";

const HOST_PORT = /(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}/;

describe("the closed vocabulary", () => {
  test("every code is SCREAMING_SNAKE and carries no prose", () => {
    for (const code of PIPELINE_ERROR_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z_]+$/);
      expect(code).not.toContain(" ");
    }
  });

  test("every code has a picker hint", () => {
    for (const code of PIPELINE_ERROR_CODES) {
      expect(pipelineFailure(code).picker.length).toBeGreaterThan(0);
    }
  });

  test("B-01's picker hints: boq-line, project, value", () => {
    expect(pipelineFailure("BOQ_LINE_NOT_FOUND").picker).toBe("boq-line");
    expect(pipelineFailure("PROJECT_REQUIRED").picker).toBe("project");
    expect(pipelineFailure("VALUE_REQUIRED").picker).toBe("value");
    // Nothing to pick for a transport failure -- it is a Retry.
    expect(pipelineFailure("BACKEND_UNAVAILABLE").picker).toBe("none");
  });
});

describe("codeForParam -- a missing parameter gets the right code", () => {
  test("the D-03 parameters", () => {
    expect(codeForParam("itemCode")).toBe("BOQ_LINE_REQUIRED");
    expect(codeForParam("boqLineItemId")).toBe("BOQ_LINE_REQUIRED");
    expect(codeForParam("projectId")).toBe("PROJECT_REQUIRED");
    expect(codeForParam("percent")).toBe("VALUE_REQUIRED");
    expect(codeForParam("attendanceDate")).toBe("DATE_REQUIRED");
    expect(codeForParam("rosterId")).toBe("WORKER_REQUIRED");
  });

  test("an unknown parameter falls back to VALUE_REQUIRED rather than inventing a code", () => {
    expect(codeForParam("somethingNobodyDeclared")).toBe("VALUE_REQUIRED");
  });
});

describe("isTransportErrorMessage -- B-01's normalisation trigger", () => {
  test("the real R66 message is recognised", () => {
    expect(isTransportErrorMessage("write CONNECT_TIMEOUT 3.109.171.244:6543")).toBe(true);
  });

  test("the other driver/network shapes", () => {
    expect(isTransportErrorMessage("connect ECONNREFUSED 127.0.0.1:5432")).toBe(true);
    expect(isTransportErrorMessage("getaddrinfo ENOTFOUND db.example.supabase.co")).toBe(true);
    expect(isTransportErrorMessage("Error: canceling statement due to statement timeout")).toBe(true);
    expect(isTransportErrorMessage("upstream responded 503")).toBe(true);
  });

  test("a genuine application bug is NOT called a transport failure", () => {
    expect(isTransportErrorMessage("Cannot read properties of undefined (reading 'id')")).toBe(false);
  });
});

describe("normaliseThrownError -- the raw text never leaves `debug`", () => {
  test("a connection timeout becomes exactly BACKEND_UNAVAILABLE", () => {
    const { failure, debug } = normaliseThrownError(new Error("write CONNECT_TIMEOUT 3.109.171.244:6543"));
    expect(failure.code).toBe("BACKEND_UNAVAILABLE");
    expect(failure.missing).toEqual([]);
    // The address survives ONLY in debug, which is logged and never persisted.
    expect(debug).toContain("3.109.171.244:6543");
    expect(JSON.stringify(failure)).not.toMatch(HOST_PORT);
  });

  test("an unexpected bug becomes INTERNAL_ERROR, not BACKEND_UNAVAILABLE", () => {
    const { failure } = normaliseThrownError(new TypeError("x is not a function"));
    expect(failure.code).toBe("INTERNAL_ERROR");
  });

  test("a non-Error throw is still normalised", () => {
    expect(normaliseThrownError("boom").failure.code).toBe("INTERNAL_ERROR");
  });
});

describe("serialiseFailure / parseFailure -- what the task row stores", () => {
  test("round-trips code, missing and context", () => {
    const f = pipelineFailure("BOQ_LINE_NOT_FOUND", ["itemCode"], { itemCode: "EX-01", version: "1" });
    const stored = serialiseFailure(f);
    expect(parseFailure(stored)).toEqual(f);
  });

  test("the stored string carries no host:port and no debug field", () => {
    const { failure } = normaliseThrownError(new Error("write CONNECT_TIMEOUT 3.109.171.244:6543"));
    const stored = serialiseFailure(failure);
    expect(stored).not.toMatch(HOST_PORT);
    expect(stored).not.toContain("debug");
    expect(JSON.parse(stored).code).toBe("BACKEND_UNAVAILABLE");
  });

  test("a legacy prose row parses to null so the client's own mapper handles it", () => {
    expect(parseFailure("itemCode is required")).toBeNull();
    expect(parseFailure(null)).toBeNull();
    expect(parseFailure("")).toBeNull();
  });

  test("an unknown code in a stored row is rejected rather than trusted", () => {
    expect(parseFailure('{"code":"MADE_UP_CODE","missing":[]}')).toBeNull();
  });
});

describe("failureLogLine -- engineers only, never a UI string", () => {
  test("is a code line, not a sentence", () => {
    const line = failureLogLine(pipelineFailure("BOQ_LINE_NOT_FOUND", ["itemCode"], { itemCode: "EX-01" }));
    expect(line).toBe('BOQ_LINE_NOT_FOUND missing=itemCode context={"itemCode":"EX-01"}');
    expect(line).not.toContain(" is required");
  });
});
