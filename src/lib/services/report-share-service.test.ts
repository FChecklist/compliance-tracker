/// <reference types="bun-types" />
// R67 E-12 (R-136). The share link's OWN rule, tested without a database: a
// token may only be minted for a report type this service can really resolve.
//
// That is not a formality. Item E-09 left the Reports screen's Share copying an
// in-app URL specifically because minting a token for project-status would have
// produced a PUBLIC link that 404s for whoever received it -- the service
// accepted only "work_progress", and resolveReportShareLink refused everything
// else. E-12 adds the type and the public renderer together; this test is what
// stops the two drifting apart again.
import { describe, expect, test } from "bun:test"
import {
  SHAREABLE_REPORT_TYPES,
  ServiceError,
  assertReportRef,
  assertShareableReportType,
} from "./report-share-service"

describe("what a share link may be minted for (R67 E-12)", () => {
  test("both shipped report types are accepted", () => {
    expect(assertShareableReportType("work_progress")).toBe("work_progress")
    expect(assertShareableReportType("project_status")).toBe("project_status")
    expect([...SHAREABLE_REPORT_TYPES]).toEqual(["work_progress", "project_status"])
  })

  test("a type with no public renderer is refused, and the refusal names the real vocabulary", () => {
    expect(() => assertShareableReportType("attendance")).toThrow(ServiceError)
    try {
      assertShareableReportType("attendance")
    } catch (error) {
      expect((error as ServiceError).message).toBe(
        "Unsupported report type. Shareable reports: work_progress, project_status"
      )
      expect((error as ServiceError).status).toBe(400)
    }
  })

  test("a non-string type is refused rather than coerced into one", () => {
    for (const bad of [null, undefined, 7, {}, ["work_progress"]]) {
      expect(() => assertShareableReportType(bad)).toThrow(ServiceError)
    }
  })
})

describe("what a share link must carry (R67 E-12)", () => {
  test("a complete reference comes back exactly as given", () => {
    expect(assertReportRef({ projectId: "p-1", from: "2026-01-01", to: "2026-09-03" })).toEqual({
      projectId: "p-1", from: "2026-01-01", to: "2026-09-03",
    })
  })

  test("any missing part is refused BEFORE a row is written, so no dead token is ever stored", () => {
    for (const bad of [
      undefined,
      {},
      { projectId: "p-1" },
      { projectId: "p-1", from: "2026-01-01" },
      { from: "2026-01-01", to: "2026-09-03" },
    ]) {
      expect(() => assertReportRef(bad)).toThrow("reportRef.projectId, from and to are required")
    }
  })

  test("extra keys are dropped -- the stored reference is the link's identity and JSON.stringify order matters to listReportShareLinks", () => {
    expect(assertReportRef({ projectId: "p-1", from: "a", to: "b", vendorId: "v-9" })).toEqual({
      projectId: "p-1", from: "a", to: "b",
    })
  })
})
