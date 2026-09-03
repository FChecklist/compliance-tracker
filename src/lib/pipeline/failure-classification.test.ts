/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  PIPELINE_ERROR_CODES,
  SYSTEM_FAILURE_MESSAGE,
  classifyFailure,
  isSystemErrorCode,
  maskInfrastructure,
} from "./failure-classification";

const IP_PORT = /\d+\.\d+\.\d+\.\d+:\d+/;

describe("the row the R66 walkthrough captured", () => {
  test("a pool timeout is a SYSTEM failure with no IP left in it", () => {
    const f = classifyFailure(new Error("write CONNECT_TIMEOUT 3.109.171.244:6543"));
    expect(f.status).toBe("failed_system");
    expect(f.code).toBe("INFRA_UNAVAILABLE");
    expect(f.message).toBe(SYSTEM_FAILURE_MESSAGE);
    expect(f.message).not.toMatch(IP_PORT);
    expect(f.message).not.toContain("CONNECT_TIMEOUT");
  });

  test("the raw text is KEPT, but separately -- it is ours, not the user's", () => {
    const f = classifyFailure(new Error("write CONNECT_TIMEOUT 3.109.171.244:6543"));
    expect(f.details).toBe("write CONNECT_TIMEOUT 3.109.171.244:6543");
    expect(f.details).not.toBe(f.message);
  });

  test("a system failure carries a retry token", () => {
    const f = classifyFailure(new Error("ECONNRESET"), 1_756_800_000_000);
    expect(f.retryToken).toBeTruthy();
    expect(f.retryToken).toBe(classifyFailure(new Error("ECONNRESET"), 1_756_800_000_000).retryToken);
  });

  test("every shape of transport failure this stack really produces lands as system", () => {
    for (const raw of [
      "ECONNRESET",
      "ETIMEDOUT",
      "connection terminated unexpectedly",
      "Timeout exceeded when trying to connect",
      "canceling statement due to statement timeout",
      "fetch failed",
      "socket hang up",
      "upstream error",
      "502 Bad Gateway",
    ]) {
      expect(classifyFailure(new Error(raw)).status).toBe("failed_system");
    }
  });
});

describe("a failure the user can fix keeps its slot and its own words", () => {
  test("a missing item code names the BOQ line slot", () => {
    const f = classifyFailure(new Error("itemCode is required"));
    expect(f.status).toBe("failed");
    expect(f.code).toBe("BOQ_LINE_REQUIRED");
    expect(f.missing).toEqual(["itemCode"]);
  });

  test("a line that is not on the BOQ is a different question from a missing one", () => {
    expect(classifyFailure(new Error(`item code "01" not found in this project's BOQ`)).code).toBe(
      "BOQ_LINE_NOT_FOUND"
    );
  });

  test("no project resolved asks for a project", () => {
    const f = classifyFailure(new Error("no project resolved for this task"));
    expect(f.code).toBe("PROJECT_REQUIRED");
    expect(f.missing).toEqual(["projectId"]);
  });

  test("an ambiguous task match asks which task", () => {
    expect(classifyFailure(new Error(`"joinery" matches 2 tasks on this project -- name one of them`)).code).toBe(
      "TASK_REQUIRED"
    );
    expect(classifyFailure(new Error(`no task on this project matches "joinery"`)).code).toBe("TASK_REQUIRED");
  });

  test("an out-of-range percent is a value question", () => {
    expect(classifyFailure(new Error("percent must be a number between 0 and 100, got 400")).code).toBe(
      "VALUE_REQUIRED"
    );
  });

  test("an unregistered function is a gap, not a retryable failure", () => {
    const f = classifyFailure(new Error(`no executor is registered for function_id "approve_variation" yet`));
    expect(f.code).toBe("FUNCTION_NOT_AVAILABLE");
    expect(f.status).toBe("failed");
  });

  test("an executor's own deliberate sentence survives -- it is the useful half", () => {
    const f = classifyFailure(new Error("this BOQ has no line 3.04"));
    expect(f.code).toBe("UNKNOWN");
    expect(f.status).toBe("failed");
    expect(f.message).toBe("this BOQ has no line 3.04");
  });
});

describe("system wins over every other reading", () => {
  test("a pool timeout that mentions a BOQ line is still a pool timeout", () => {
    const f = classifyFailure(new Error("itemCode is required: CONNECT_TIMEOUT 10.0.0.4:5432"));
    expect(f.status).toBe("failed_system");
    expect(f.code).toBe("INFRA_UNAVAILABLE");
  });
});

describe("masking is the server's own defence, not the browser's", () => {
  test("an IP, a host:port and a transport code all go", () => {
    const masked = maskInfrastructure("ECONNREFUSED db.abcdefgh.supabase.co:5432 / 3.109.171.244:6543");
    expect(masked).not.toMatch(IP_PORT);
    expect(masked).not.toContain("supabase.co:5432");
    expect(masked).not.toContain("ECONNREFUSED");
  });

  test("a sentence with nothing technical in it comes back untouched", () => {
    expect(maskInfrastructure("this BOQ has no line 3.04")).toBe("this BOQ has no line 3.04");
  });

  test("empty in, empty out -- it never invents a sentence", () => {
    expect(maskInfrastructure("")).toBe("");
  });
});

describe("the vocabulary stays closed", () => {
  test("every code classifyFailure can return is in the declared set", () => {
    const samples = [
      "CONNECT_TIMEOUT 1.2.3.4:5432",
      "itemCode is required",
      `item code "01" not found in this project's BOQ`,
      "no project resolved for this task",
      "percent is required",
      `no task on this project matches "x"`,
      "no executor is registered for function_id \"x\" yet",
      "something nobody has seen before",
    ];
    for (const s of samples) {
      expect(PIPELINE_ERROR_CODES).toContain(classifyFailure(new Error(s)).code);
    }
  });

  test("only the two infrastructure codes count as system", () => {
    expect(isSystemErrorCode("INFRA_UNAVAILABLE")).toBe(true);
    expect(isSystemErrorCode("BACKEND_UNAVAILABLE")).toBe(true);
    expect(isSystemErrorCode("BOQ_LINE_REQUIRED")).toBe(false);
    expect(isSystemErrorCode(null)).toBe(false);
  });
});

describe("anything can be thrown, and none of it crashes the classifier", () => {
  test("a string, an object, a null and an undefined all classify", () => {
    expect(classifyFailure("ECONNRESET").status).toBe("failed_system");
    expect(classifyFailure({ message: "itemCode is required" }).code).toBe("BOQ_LINE_REQUIRED");
    expect(classifyFailure(null).code).toBe("UNKNOWN");
    expect(classifyFailure(undefined).status).toBe("failed");
  });
});
