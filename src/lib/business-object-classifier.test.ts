/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { classifyBusinessObjectType } from "./business-object-classifier"

describe("classifyBusinessObjectType", () => {
  describe("by toolkit (connector-sourced content)", () => {
    test("googlesheets and excel are always table, regardless of mimeType", () => {
      expect(classifyBusinessObjectType({ toolkit: "googlesheets", mimeType: "application/json" })).toBe("table")
      expect(classifyBusinessObjectType({ toolkit: "excel", mimeType: "application/json" })).toBe("table")
    })

    test("googledocs is document, googleslides is presentation", () => {
      expect(classifyBusinessObjectType({ toolkit: "googledocs" })).toBe("document")
      expect(classifyBusinessObjectType({ toolkit: "googleslides" })).toBe("presentation")
    })

    test("gmail, outlook, slack, microsoft_teams, googlemeet, googlecalendar are all communication", () => {
      for (const toolkit of ["gmail", "outlook", "slack", "microsoft_teams", "googlemeet", "googlecalendar"] as const) {
        expect(classifyBusinessObjectType({ toolkit })).toBe("communication")
      }
    })

    test("a toolkit with no fixed type (e.g. github, dropbox) falls through to mimeType/fileName inspection", () => {
      expect(classifyBusinessObjectType({ toolkit: "github", fileName: "report.pdf" })).toBe("document")
      expect(classifyBusinessObjectType({ toolkit: "dropbox", fileName: "budget.xlsx" })).toBe("table")
    })

    test("toolkit takes precedence over a conflicting mimeType/fileName", () => {
      // A Google Sheets export can carry an xlsx-shaped mimeType, but the
      // toolkit is the more reliable signal for connector-sourced content.
      expect(classifyBusinessObjectType({
        toolkit: "googlesheets",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileName: "notes.docx",
      })).toBe("table")
    })
  })

  describe("by mimeType (direct upload, no toolkit)", () => {
    test("Excel/CSV/ODS mimeTypes classify as table", () => {
      expect(classifyBusinessObjectType({ mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })).toBe("table")
      expect(classifyBusinessObjectType({ mimeType: "application/vnd.ms-excel" })).toBe("table")
      expect(classifyBusinessObjectType({ mimeType: "text/csv" })).toBe("table")
    })

    test("PowerPoint mimeTypes classify as presentation", () => {
      expect(classifyBusinessObjectType({ mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" })).toBe("presentation")
      expect(classifyBusinessObjectType({ mimeType: "application/vnd.ms-powerpoint" })).toBe("presentation")
    })

    test("Word/PDF/RTF mimeTypes classify as document", () => {
      expect(classifyBusinessObjectType({ mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe("document")
      expect(classifyBusinessObjectType({ mimeType: "application/pdf" })).toBe("document")
      expect(classifyBusinessObjectType({ mimeType: "application/rtf" })).toBe("document")
    })

    test("email/calendar mimeTypes classify as communication", () => {
      expect(classifyBusinessObjectType({ mimeType: "message/rfc822" })).toBe("communication")
      expect(classifyBusinessObjectType({ mimeType: "text/calendar" })).toBe("communication")
    })
  })

  describe("by fileName extension (mimeType missing or generic)", () => {
    test("falls back to extension when mimeType is null/generic", () => {
      expect(classifyBusinessObjectType({ mimeType: "application/octet-stream", fileName: "Q1-budget.xlsx" })).toBe("table")
      expect(classifyBusinessObjectType({ mimeType: null, fileName: "deck.pptx" })).toBe("presentation")
      expect(classifyBusinessObjectType({ fileName: "invite.ics" })).toBe("communication")
      expect(classifyBusinessObjectType({ fileName: "contract.pdf" })).toBe("document")
    })

    test("extension check is case-insensitive", () => {
      expect(classifyBusinessObjectType({ fileName: "REPORT.XLSX" })).toBe("table")
    })
  })

  describe("fallback behaviour", () => {
    test("no toolkit, no mimeType, no fileName -> document (safe default)", () => {
      expect(classifyBusinessObjectType({})).toBe("document")
    })

    test("an unrecognised extension/mimeType -> document, not a throw", () => {
      expect(classifyBusinessObjectType({ mimeType: "application/x-unknown-format", fileName: "mystery.xyz" })).toBe("document")
    })
  })

  describe("the guardrail this module exists to satisfy", () => {
    test("Excel and Google Sheets normalize to the SAME Business Object type -- the whole point of U-D26.B3.S1", () => {
      const excelUpload = classifyBusinessObjectType({ mimeType: "application/vnd.ms-excel", fileName: "budget.xls" })
      const googleSheetsConnector = classifyBusinessObjectType({ toolkit: "googlesheets" })
      expect(excelUpload).toBe(googleSheetsConnector)
      expect(excelUpload).toBe("table")
    })
  })
})
