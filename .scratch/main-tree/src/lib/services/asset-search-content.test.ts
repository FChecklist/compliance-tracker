/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { buildAssetSearchContent } from "./asset-search-content"

describe("buildAssetSearchContent", () => {
  test("joins name, purpose, and searchKeywords with the pipe separator", () => {
    expect(
      buildAssetSearchContent({ name: "GST Filer", purpose: "Files monthly GST returns", searchKeywords: "gst tax filing" })
    ).toBe("GST Filer | Files monthly GST returns | gst tax filing")
  })

  test("falls back to just the name when purpose and searchKeywords are absent", () => {
    expect(buildAssetSearchContent({ name: "GST Filer" })).toBe("GST Filer")
  })

  test("drops null fields instead of leaving a stray separator", () => {
    expect(buildAssetSearchContent({ name: "GST Filer", purpose: null, searchKeywords: "gst" })).toBe("GST Filer | gst")
  })

  test("drops empty-string fields the same as null/undefined", () => {
    expect(buildAssetSearchContent({ name: "GST Filer", purpose: "", searchKeywords: "" })).toBe("GST Filer")
  })
})
