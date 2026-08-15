/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchDocumentProcessingEngines } from "./dispatch-document-processing-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchDocumentProcessingEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchDocumentProcessingEngines("email_validation_engine", {})).toBe(NOT_HANDLED)
  })

  test("duplicate_document_detection_engine rejects a non-array documents", async () => {
    expect(dispatchDocumentProcessingEngines("duplicate_document_detection_engine", { documents: "nope" })).rejects.toThrow("documents must be an array")
  })

  test("duplicate_document_detection_engine groups documents sharing a contentHash", async () => {
    const result = await dispatchDocumentProcessingEngines("duplicate_document_detection_engine", {
      documents: [{ id: "a", contentHash: "x" }, { id: "b", contentHash: "x" }, { id: "c", contentHash: "y" }],
    }) as { duplicateGroups: unknown[] }
    expect(result.duplicateGroups.length).toBe(1)
  })
})
