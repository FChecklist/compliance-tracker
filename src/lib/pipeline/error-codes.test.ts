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

// ── R67 B-08: the typed columns, and the one timeout that is not a refusal ─
import { failureFromRow, isStatementTimeoutMessage, RETRYABLE_ERROR_CODES } from "./error-codes";

describe("B-08 -- a statement timeout is its own code", () => {
  test("Postgres cancelling a slow query is UPSTREAM_TIMEOUT, not BACKEND_UNAVAILABLE", () => {
    expect(isStatementTimeoutMessage("canceling statement due to statement timeout")).toBe(true);
    expect(normaliseThrownError(new Error("canceling statement due to statement timeout")).failure.code).toBe(
      "UPSTREAM_TIMEOUT"
    );
  });

  test("a CONNECTION timeout is still exactly BACKEND_UNAVAILABLE -- B-01's acceptance is untouched", () => {
    expect(isStatementTimeoutMessage("write CONNECT_TIMEOUT 3.109.171.244:6543")).toBe(false);
    expect(normaliseThrownError(new Error("write CONNECT_TIMEOUT 3.109.171.244:6543")).failure.code).toBe(
      "BACKEND_UNAVAILABLE"
    );
  });

  test("both are retryable; a user-fixable failure is not", () => {
    expect(RETRYABLE_ERROR_CODES.has("BACKEND_UNAVAILABLE")).toBe(true);
    expect(RETRYABLE_ERROR_CODES.has("UPSTREAM_TIMEOUT")).toBe(true);
    expect(RETRYABLE_ERROR_CODES.has("BOQ_LINE_REQUIRED")).toBe(false);
    expect(RETRYABLE_ERROR_CODES.has("INTERNAL_ERROR")).toBe(false);
  });
});

describe("B-08 -- failureFromRow reads the typed columns drizzle/0528 adds", () => {
  test("a real code and its business params come back as a failure", () => {
    const f = failureFromRow("BOQ_LINE_NOT_FOUND", { itemCode: "1", project: "Cedar Heights Villa - Phase 1", version: "Rev0" });
    expect(f).not.toBeNull();
    expect(f!.code).toBe("BOQ_LINE_NOT_FOUND");
    expect(f!.picker).toBe("boq-line");
    expect(f!.context).toEqual({ itemCode: "1", project: "Cedar Heights Villa - Phase 1", version: "Rev0" });
  });

  test("an empty, unknown or malformed column yields null so the caller falls back", () => {
    expect(failureFromRow(null, null)).toBeNull();
    expect(failureFromRow("", null)).toBeNull();
    expect(failureFromRow("SOMETHING_A_NEWER_SERVER_SENDS", {})).toBeNull();
  });

  test("a non-object params column is ignored rather than trusted", () => {
    const f = failureFromRow("BACKEND_UNAVAILABLE", "write CONNECT_TIMEOUT 3.109.171.244:6543");
    expect(f!.context).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R67 B-11 -- the D-03 field vocabulary
// ═══════════════════════════════════════════════════════════════════════════
import { FIELD_VOCABULARY, vocabularyKeyForParam } from "./error-codes";

describe("B-11 -- vocabularyKeyForParam maps a parameter to the key a client renders", () => {
  test("every parameter the real function catalogue declares maps into the vocabulary", () => {
    const declared = ["projectId", "itemCode", "boqLineItemId", "percent", "quantityDone", "rosterId", "date", "scheduledAt", "boqId"];
    for (const param of declared) {
      expect(FIELD_VOCABULARY).toContain(vocabularyKeyForParam(param) as (typeof FIELD_VOCABULARY)[number]);
    }
  });

  test("the five D-03 fields resolve to their own keys", () => {
    expect(vocabularyKeyForParam("projectId")).toBe("project");
    expect(vocabularyKeyForParam("itemCode")).toBe("boqLine");
    expect(vocabularyKeyForParam("boqLineItemId")).toBe("boqLine");
    expect(vocabularyKeyForParam("percent")).toBe("value");
    expect(vocabularyKeyForParam("quantityDone")).toBe("value");
  });

  test("an unmapped camelCase parameter degrades to 'value' rather than reaching a screen", () => {
    expect(vocabularyKeyForParam("externalUrl")).toBe("value");
    expect(vocabularyKeyForParam("someInternalThing")).toBe("value");
  });

  test("an unmapped single lower-case word keeps its own readable name", () => {
    expect(vocabularyKeyForParam("title")).toBe("title");
    expect(vocabularyKeyForParam("category")).toBe("category");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R67 FIX PASS -- a service's own 4xx, and what is safe to put in a payload
// ═══════════════════════════════════════════════════════════════════════════
import { codeForServiceError, isRetryableFailure, revealsInternals } from "./error-codes";

describe("FIX PASS -- codeForServiceError maps a status, never a sentence", () => {
  test("the three statuses the registered writes actually raise", () => {
    expect(codeForServiceError(404)).toBe("RECORD_NOT_FOUND");
    expect(codeForServiceError(409)).toBe("ALREADY_RECORDED");
    expect(codeForServiceError(403)).toBe("NOT_PERMITTED");
  });

  test("401 is the same refusal as 403", () => {
    expect(codeForServiceError(401)).toBe("NOT_PERMITTED");
  });

  test("any other 4xx is REQUEST_REJECTED, never INTERNAL_ERROR", () => {
    for (const status of [400, 402, 405, 410, 422, 429]) {
      expect(codeForServiceError(status)).toBe("REQUEST_REJECTED");
    }
  });

  test("every code it can return is in the closed set, and none of them is retryable", () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      const code = codeForServiceError(status);
      expect(PIPELINE_ERROR_CODES as readonly string[]).toContain(code);
      // A 4xx says something about the REQUEST. Recording it as `waiting`
      // and offering [Retry] would promise the user that sending the same
      // thing again could work.
      expect(isRetryableFailure(code)).toBe(false);
    }
  });
});

describe("FIX PASS -- revealsInternals is narrower than isTransportErrorMessage", () => {
  test("the R66 string is caught: a driver errno and a host:port", () => {
    expect(revealsInternals("write CONNECT_TIMEOUT 3.109.171.244:6543")).toBe(true);
    expect(revealsInternals("connect ECONNREFUSED db.example.supabase.co:5432")).toBe(true);
  });

  test("an ordinary business sentence carrying a three-digit number is NOT internal", () => {
    // isTransportErrorMessage's \b5\d\d\b clause is right for classifying a
    // thrown driver error and wrong for deciding what a stored sentence may
    // show. Both behaviours asserted, so the difference cannot be "fixed"
    // by accident.
    expect(isTransportErrorMessage("line 512 not found")).toBe(true);
    expect(revealsInternals("line 512 not found")).toBe(false);
    expect(revealsInternals("itemCode is required")).toBe(false);
    expect(revealsInternals("no project resolved for this task")).toBe(false);
  });
});
