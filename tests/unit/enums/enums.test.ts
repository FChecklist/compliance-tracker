import { describe, it, expect } from "vitest";
import { ComplianceStatus, StatusTransitions, Priority, Role } from "@compliancetrack/types";

describe("Enums", () => {
  it("StatusTransitions are valid", () => {
    expect(StatusTransitions[ComplianceStatus.PENDING]).toContain(ComplianceStatus.IN_PROGRESS);
    expect(StatusTransitions[ComplianceStatus.IN_PROGRESS]).toContain(ComplianceStatus.COMPLETED);
  });

  it("Priority enum has 4 values", () => {
    expect(Object.keys(Priority).length).toBe(4);
  });

  it("Role enum has 4 values", () => {
    expect(Object.keys(Role).length).toBe(4);
  });
});