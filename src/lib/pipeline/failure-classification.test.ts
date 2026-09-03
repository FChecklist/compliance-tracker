/// <reference types="bun-types" />
// R67 WS-C (C-13), rewritten in the FIX PASS.
//
// WHAT CHANGED AND WHY. Lane B's error-codes.ts merged to main carrying the
// same two exported symbol names over a different vocabulary, so under D-11
// this module stopped declaring one and became a thin layer over lane B's --
// adding only the system/user split and the retry token. These tests follow:
// the ones that pinned lane C's own duplicate vocabulary are gone, the ones
// that pin behaviour lane C still owns are kept, and two are NEW because the
// fix pass found real defects in the masking.
import { describe, expect, test } from "bun:test";
import {
  SYSTEM_FAILURE_MESSAGE,
  classifyFailure,
  classifyPipelineFailure,
  isSystemErrorCode,
  looksLikeSystemText,
  maskInfrastructure,
} from "./failure-classification";
import { PIPELINE_ERROR_CODES, pipelineFailure } from "./error-codes";

const IP_PORT = /\d+\.\d+\.\d+\.\d+:\d+/;

describe("the row the R66 walkthrough captured", () => {
  test("a pool timeout is a SYSTEM failure with no IP left in it", () => {
    const f = classifyFailure(new Error("write CONNECT_TIMEOUT 3.109.171.244:6543"));
    expect(f.status).toBe("failed_system");
    expect(f.code).toBe("BACKEND_UNAVAILABLE");
    expect(f.message).toBe(SYSTEM_FAILURE_MESSAGE);
    expect(f.message).not.toMatch(IP_PORT);
    expect(f.message).not.toContain("CONNECT_TIMEOUT");
  });

  test("the raw text is KEPT, but separately -- it is ours, not the user's", () => {
    const f = classifyFailure(new Error("write CONNECT_TIMEOUT 3.109.171.244:6543"));
    expect(f.details).toContain("write CONNECT_TIMEOUT 3.109.171.244:6543");
    expect(f.details).not.toBe(f.message);
  });

  test("a system failure carries a retry token, and the same failure yields the same one", () => {
    const f = classifyFailure(new Error("ECONNRESET"), 1_756_800_000_000);
    expect(f.retryToken).toBeTruthy();
    expect(f.retryToken).toBe(classifyFailure(new Error("ECONNRESET"), 1_756_800_000_000).retryToken);
  });

  test("a user-fixable failure carries NO retry token -- retrying it would fail identically", () => {
    const f = classifyPipelineFailure(pipelineFailure("BOQ_LINE_REQUIRED", ["boqLine"]));
    expect(f.status).toBe("failed");
    expect(f.retryToken).toBeUndefined();
  });

  test("every shape of transport failure this stack really produces lands as system", () => {
    for (const raw of [
      "ECONNRESET",
      "ETIMEDOUT",
      "connection terminated unexpectedly",
      "Timeout exceeded when trying to connect",
      "canceling statement due to statement timeout",
      "write CONNECT_TIMEOUT 3.109.171.244:6543",
      "upstream responded 503",
    ]) {
      expect(classifyFailure(new Error(raw)).status).toBe("failed_system");
    }
  });
});

describe("a failure the user can fix keeps its slot and stays in their list", () => {
  // A RETURNED failure -- which is how every executor on main reports a
  // refusal now (B-01: they return pipelineFailure(...), they do not throw
  // prose). The code an executor chose is the authority and nothing here
  // re-reads it out of a sentence.
  test("a missing BOQ line names the slot and is the user's to fix", () => {
    const f = classifyPipelineFailure(pipelineFailure("BOQ_LINE_REQUIRED", ["boqLine"]));
    expect(f.status).toBe("failed");
    expect(f.code).toBe("BOQ_LINE_REQUIRED");
    expect(f.missing).toEqual(["boqLine"]);
  });

  test("an unregistered function is a gap, not an outage", () => {
    const f = classifyPipelineFailure(pipelineFailure("FUNCTION_NOT_AVAILABLE"));
    expect(f.status).toBe("failed");
    expect(f.retryToken).toBeUndefined();
  });

  // *** THE FIX-PASS REGRESSION. ***
  //
  // Lane C's original classifier ran its own SYSTEM_PATTERNS -- including a
  // bare /\b(?:502|503|504)\b/ -- BEFORE any user pattern, and system won. A
  // BOQ line numbered 502 therefore turned an ordinary "pick another line"
  // into "the service didn't answer": the row left the needs-you list, the
  // actionable sentence was replaced, and the user was told to wait for a
  // service that was fine. BOQ item codes numbered 501/502/503 are ordinary.
  //
  // It cannot happen now, and this pins BOTH halves of why: the executor
  // reports a CODE rather than a sentence, and this module never second
  // -guesses that code.
  test("a BOQ line that happens to be numbered 502 is still a BOQ question", () => {
    const f = classifyPipelineFailure(
      pipelineFailure("BOQ_LINE_NOT_FOUND", ["itemCode"], { itemCode: "502", project: "Cedar Heights" })
    );
    expect(f.status).toBe("failed");
    expect(f.code).toBe("BOQ_LINE_NOT_FOUND");
    expect(f.message).not.toBe(SYSTEM_FAILURE_MESSAGE);
    expect(isSystemErrorCode(f.code)).toBe(false);
  });
});

describe("masking is the server's own defence, not the browser's", () => {
  test("an IP:port, a host:port and a transport code all go", () => {
    const masked = maskInfrastructure("ECONNREFUSED db.abcdefgh.supabase.co:5432 / 3.109.171.244:6543");
    expect(masked).not.toMatch(IP_PORT);
    expect(masked).not.toContain("supabase.co:5432");
    expect(masked).not.toContain("ECONNREFUSED");
  });

  // *** FIX-PASS REGRESSION 1: A DOTTED BOQ CODE IS NOT AN IP ADDRESS. ***
  // The IP pattern made the port optional, so a four-segment item code --
  // the shape this repo's own fixtures use ("1.01.1", "1.01.1.a") -- was
  // masked out of a sentence that was about it.
  test("a four-segment BOQ item code survives masking untouched", () => {
    expect(maskInfrastructure("record 50% on 1.01.1.2")).toBe("record 50% on 1.01.1.2");
    expect(maskInfrastructure("there is no line 1.01.1 on Cedar Heights")).toBe(
      "there is no line 1.01.1 on Cedar Heights"
    );
  });

  // *** FIX-PASS REGRESSION 2: THE STUTTER COLLAPSE KEPT EATING SPACES. ***
  // The collapse was /(?:the service[\s,]*)+/g, whose trailing [\s,]* ate the
  // separator AFTER the last replacement, so masked sentences ran together.
  test("collapsing repeats never removes the separator that followed them", () => {
    const masked = maskInfrastructure("write CONNECT_TIMEOUT 3.109.171.244:6543 while saving");
    expect(masked).toContain(" while saving");
    expect(masked).not.toMatch(/\w(?:the service|unavailable)\w/);
    expect(maskInfrastructure("1.2.3.4:5432 1.2.3.4:5432 then done")).toBe("the service then done");
  });

  test("a sentence with nothing technical in it comes back untouched", () => {
    expect(maskInfrastructure("this BOQ has no line 3.04")).toBe("this BOQ has no line 3.04");
  });

  test("empty in, empty out -- it never invents a sentence", () => {
    expect(maskInfrastructure("")).toBe("");
  });
});

describe("the vocabulary stays closed, and it is lane B's", () => {
  test("every code classifyFailure can return is in error-codes.ts's declared set", () => {
    const samples = [
      "CONNECT_TIMEOUT 1.2.3.4:5432",
      "canceling statement due to statement timeout",
      "Cannot read properties of undefined (reading 'id')",
      "something nobody has seen before",
    ];
    for (const s of samples) {
      expect(PIPELINE_ERROR_CODES).toContain(classifyFailure(new Error(s)).code);
    }
  });

  test("the system set is the transport codes plus the alias older rows carry", () => {
    expect(isSystemErrorCode("BACKEND_UNAVAILABLE")).toBe(true);
    expect(isSystemErrorCode("UPSTREAM_TIMEOUT")).toBe(true);
    expect(isSystemErrorCode("INTERNAL_ERROR")).toBe(true);
    // Lane C's own earlier build wrote this code; a code this build did not
    // recognise must not silently become a user-fixable row.
    expect(isSystemErrorCode("INFRA_UNAVAILABLE")).toBe(true);
    expect(isSystemErrorCode("BOQ_LINE_REQUIRED")).toBe(false);
    expect(isSystemErrorCode("FUNCTION_NOT_AVAILABLE")).toBe(false);
    expect(isSystemErrorCode(null)).toBe(false);
    expect(isSystemErrorCode(undefined)).toBe(false);
  });

  test("looksLikeSystemText is lane B's two predicates, not a third one", () => {
    expect(looksLikeSystemText("write CONNECT_TIMEOUT 3.109.171.244:6543")).toBe(true);
    expect(looksLikeSystemText("canceling statement due to statement timeout")).toBe(true);
    expect(looksLikeSystemText("pick a different line")).toBe(false);
  });
});

describe("anything can be thrown, and none of it crashes the classifier", () => {
  test("a string, an object, a null and an undefined all classify", () => {
    expect(classifyFailure("ECONNRESET").status).toBe("failed_system");
    expect(PIPELINE_ERROR_CODES).toContain(classifyFailure({ message: "boom" }).code);
    // A thing nobody can classify is INTERNAL_ERROR, and an internal error is
    // OURS -- there is no field a foreman can fill in to fix a bug, so it is
    // system, gets the one honest sentence and gets a retry token.
    expect(classifyFailure(null).code).toBe("INTERNAL_ERROR");
    expect(classifyFailure(null).status).toBe("failed_system");
    expect(classifyFailure(undefined).status).toBe("failed_system");
    expect(classifyFailure(undefined).message).toBe(SYSTEM_FAILURE_MESSAGE);
  });
});
