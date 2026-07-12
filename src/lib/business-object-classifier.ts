// Wave (2026-07-12, Priority-2 D26.B3.S1): the Universal Connector's own
// requirement (ai-os/tree4-unified/10-merged-governance-layer.yaml
// U-D26.B3.S1) names a 4-type Business Object normalization layer -- every
// connected source becomes one of Table/Document/Presentation/Communication,
// with an explicit guardrail: "No downstream code may branch on 'is this
// Excel or Google Sheets.'"
//
// Direct grep of the document-handling code paths (src/lib/ingest/parser.ts,
// src/lib/ingest/extractor.ts, src/lib/services/document-extraction-
// service.ts, src/app/api/documents/**) found format-specific branching --
// but confined to two legitimate, narrow categories this guardrail isn't
// actually about:
//   1. Low-level parsing-LIBRARY selection (parser.ts picking the xlsx lib
//      vs pdf-parse by extension/mimeType) -- inherent to turning raw bytes
//      into text/rows at all, not a business-logic decision.
//   2. A single "can this model literally see this input" capability check
//      (document-extraction-service.ts's isVisionExtractable) -- gating on
//      what's technically possible, not routing business BEHAVIOR by format.
// No feature-level code (approval routing, workflow assignment, compliance
// classification, etc.) branches on file format today -- there wasn't one
// to violate, because B2.S1 (per-app connector behaviors) and B4.S1
// (Business Digital Twin) don't exist yet: nothing currently pulls real
// content FROM a connected account (src/app/api/connectors/** only ever
// tracks OAuth connection status -- see composio-connectors.ts -- it never
// fetches files/messages). So the guardrail was neither respected-by-design
// nor violated in practice; there was no downstream business logic for it
// to apply to yet.
//
// This module is the missing piece: a single authorized place format gets
// looked at, producing a stable 4-type vocabulary for everything downstream.
// Scope is deliberately narrow -- a shared type + a pure classifier
// function, not a rearchitecture of documents/connectors (that's B4.S1's
// Business Digital Twin, explicitly out of scope for this pass -- see
// ai-os/tree4-unified/50-completion-plan/07-priority2-tracker.yaml). Wired
// into the one real, low-risk call site that exists today: GET/POST
// /api/documents derive `businessObjectType` from the already-stored
// fileType/name -- no schema migration, no change to any existing field.

import type { ConnectorToolkit } from "@/lib/composio-connectors"

export type BusinessObjectType = "table" | "document" | "presentation" | "communication"

export type ClassifiableSource = {
  /** MIME type as reported by the browser/storage/connector, when known. */
  mimeType?: string | null
  /** Original file name -- used only as a fallback when mimeType is missing or generic (e.g. application/octet-stream). */
  fileName?: string | null
  /** The Composio toolkit slug this content came from, when it came from a connector rather than a direct upload. Some toolkits (Sheets/Slides/Gmail/Meet) are unambiguous regardless of mimeType, so this is checked first. */
  toolkit?: ConnectorToolkit | null
}

const TABLE_EXT = new Set(["xlsx", "xls", "xlsm", "xlsb", "csv", "tsv", "ods"])
const PRESENTATION_EXT = new Set(["ppt", "pptx", "odp", "key"])
const COMMUNICATION_EXT = new Set(["eml", "msg", "ics"])
const DOCUMENT_EXT = new Set(["doc", "docx", "odt", "pdf", "rtf", "txt", "md"])

const TABLE_MIME_FRAGMENTS = ["spreadsheet", "ms-excel", "csv"]
const PRESENTATION_MIME_FRAGMENTS = ["presentation", "ms-powerpoint"]
const COMMUNICATION_MIME_FRAGMENTS = ["message/", "rfc822", "calendar"]
const DOCUMENT_MIME_FRAGMENTS = ["msword", "wordprocessing", "pdf", "rtf"]

// Toolkits whose entire purpose is one Business Object type, independent of
// whatever mimeType a specific item within them happens to report -- e.g.
// every Slack message is a Communication even though Slack's API might
// label the payload "application/json" internally.
const TOOLKIT_TYPE: Partial<Record<ConnectorToolkit, BusinessObjectType>> = {
  googlesheets: "table",
  excel: "table",
  googledocs: "document",
  googleslides: "presentation",
  gmail: "communication",
  outlook: "communication",
  slack: "communication",
  microsoft_teams: "communication",
  googlemeet: "communication",
  googlecalendar: "communication",
}

/**
 * Maps a source's toolkit/mimeType/fileName to exactly one of the 4 Business
 * Object types (U-D26.B3.S1). This is the ONE place format gets inspected --
 * callers should carry the returned BusinessObjectType onward and never
 * re-check mimeType/extension themselves; that's the guardrail this
 * function exists to satisfy ("no downstream code may branch on 'is this
 * Excel or Google Sheets'"). Falls back to "document" when nothing matches
 * -- the safest catch-all, since an unrecognised file is far more likely to
 * be a generic document than a spreadsheet/presentation/communication.
 */
export function classifyBusinessObjectType(source: ClassifiableSource): BusinessObjectType {
  if (source.toolkit) {
    const fromToolkit = TOOLKIT_TYPE[source.toolkit]
    if (fromToolkit) return fromToolkit
  }

  const ext = (source.fileName ?? "").toLowerCase().split(".").pop() ?? ""
  const mime = (source.mimeType ?? "").toLowerCase()

  if (TABLE_EXT.has(ext) || TABLE_MIME_FRAGMENTS.some((f) => mime.includes(f))) return "table"
  if (PRESENTATION_EXT.has(ext) || PRESENTATION_MIME_FRAGMENTS.some((f) => mime.includes(f))) return "presentation"
  if (COMMUNICATION_EXT.has(ext) || COMMUNICATION_MIME_FRAGMENTS.some((f) => mime.includes(f))) return "communication"
  if (DOCUMENT_EXT.has(ext) || DOCUMENT_MIME_FRAGMENTS.some((f) => mime.includes(f))) return "document"

  return "document"
}
