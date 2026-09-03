// R67 D-10 (audit R-028/R-033). The drawings register's own vocabulary, in one
// place: what a `documents` row means when its category is a drawing category,
// which of them a filter keeps, and what a row looks like once it is exported.
//
// Server-safe by construction (no "use client", no storage/DB imports): the
// list route, the single-drawing route and the export route all shape the same
// row, and each one owning its own copy of "what is a drawing" is how three
// screens start disagreeing about a Kind. Storage signing stays in the routes,
// which are the only things that should hold a service-role client.
//
// A drawing IS a documents row (Wave 143's own decision -- no parallel table,
// so retention/versioning/classification come for free); everything specific to
// drawings lives in that row's metadata jsonb.
import type { ExportRow } from "./report-export-shared"

export const DRAWING_CATEGORIES = ["drawing", "drawing_3d"] as const
export type DrawingCategory = (typeof DRAWING_CATEGORIES)[number]
export type DrawingKind = "dwg" | "3d_walkthrough"

export function isDrawingCategory(category: string | null | undefined): category is DrawingCategory {
  return category === "drawing" || category === "drawing_3d"
}

export function kindForCategory(category: string | null | undefined): DrawingKind {
  return category === "drawing_3d" ? "3d_walkthrough" : "dwg"
}

export function categoryForKind(kind: string | null | undefined): DrawingCategory {
  return kind === "3d_walkthrough" ? "drawing_3d" : "drawing"
}

/** `?kind=` is optional; anything that is not a known kind means "both". */
export function categoryFilterForKind(kind: string | null | undefined): DrawingCategory | undefined {
  if (kind === "3d_walkthrough") return "drawing_3d"
  if (kind === "dwg") return "drawing"
  return undefined
}

// ─── R67 D-12: the three states a drawing can be in ─────────────────────────
// 'current'      -- the build set: this is the one you build from.
// 'superseded'   -- a later revision with the same Drawing No. took over.
// 'for_approval' -- uploaded, not yet the build set.
export const DRAWING_STATUSES = ["current", "superseded", "for_approval"] as const
export type DrawingStatus = (typeof DRAWING_STATUSES)[number]

/** A new upload is not the build set until someone says so. */
export const DEFAULT_DRAWING_STATUS: DrawingStatus = "for_approval"

/**
 * Anything that is not one of the three is the default rather than a crash: the
 * status lives in a jsonb blob, and rows created before D-12 have no status at
 * all. They are not 'current' by accident -- that would silently promote every
 * historical row into the build set.
 */
export function normaliseDrawingStatus(raw: unknown): DrawingStatus {
  return (DRAWING_STATUSES as readonly unknown[]).includes(raw) ? (raw as DrawingStatus) : DEFAULT_DRAWING_STATUS
}

export type DrawingMetadata = {
  discipline: string | null
  isExternalLink: boolean
  drawingNo: string | null
  rev: string | null
  status: DrawingStatus
  supersedesId: string | null
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function readDrawingMetadata(raw: unknown): DrawingMetadata {
  const meta = (raw ?? {}) as Record<string, unknown>
  return {
    discipline: readString(meta.discipline),
    isExternalLink: meta.isExternalLink === true,
    drawingNo: readString(meta.drawingNo),
    rev: readString(meta.rev),
    status: normaliseDrawingStatus(meta.status),
    supersedesId: readString(meta.supersedesId),
  }
}

export type DrawingRow = {
  id: string
  name: string
  category: string | null
  metadata: unknown
  fileUrl: string
  fileType: string | null
  createdAt: Date | string
}

export type DrawingDto = {
  id: string
  name: string
  kind: DrawingKind
  discipline: string | null
  isExternalLink: boolean
  fileType: string | null
  documentUrl: string | null
  createdAt: Date | string
  /** R67 D-12: the four fields that answer "is this the one I build from?". */
  drawingNo: string | null
  rev: string | null
  status: DrawingStatus
  supersedesId: string | null
}

/**
 * Pure shaping. `documentUrl` is passed in rather than resolved here: for a
 * link-only row it is the row's own URL, and for a stored file it is a signed
 * Storage URL that only a route holding the service-role client can mint.
 */
export function toDrawingDto(doc: DrawingRow, documentUrl: string | null): DrawingDto {
  const metadata = readDrawingMetadata(doc.metadata)
  return {
    id: doc.id,
    name: doc.name,
    kind: kindForCategory(doc.category),
    discipline: metadata.discipline,
    isExternalLink: metadata.isExternalLink,
    fileType: doc.fileType,
    documentUrl,
    createdAt: doc.createdAt,
    drawingNo: metadata.drawingNo,
    rev: metadata.rev,
    status: metadata.status,
    supersedesId: metadata.supersedesId,
  }
}

/**
 * R67 D-12's "Current only" chip, on by default so the register shows the build
 * set. `status=all` (or an unknown value) means every state.
 */
export function matchesStatus(dto: { status: DrawingStatus }, status?: string | null): boolean {
  if (!status || !status.trim() || status === "all") return true
  return dto.status === status
}

/**
 * The Discipline filter, applied where the data lives. Discipline is a jsonb
 * metadata key, not a column, so it cannot be an index-backed WHERE clause on
 * `documents` -- it is applied to the project's own rows after the category/
 * project filter has already narrowed them, and it is case-insensitive because
 * "MEP" and "mep" are the same discipline typed by two people.
 */
export function matchesDiscipline(dto: { discipline: string | null }, discipline?: string | null): boolean {
  if (!discipline || !discipline.trim()) return true
  return (dto.discipline ?? "").trim().toLowerCase() === discipline.trim().toLowerCase()
}

/**
 * R67 D-11. The grace window: how long after upload the person who uploaded a
 * drawing may still undo it with a hard Remove, before the records-management
 * rules (retention, disposal, legal hold) take over. 24 hours is the item's own
 * figure, and it exists because a freshly uploaded drawing with a null
 * disposalDate is otherwise UNDELETABLE by its own uploader -- the disposal
 * gate refuses it for want of a retention policy nobody has set.
 */
export const RECENT_WINDOW_HOURS = 24

export function isRecentDrawing(createdAt: Date | string, now: Date = new Date()): boolean {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt)
  if (Number.isNaN(created.getTime())) return false
  const elapsedMs = now.getTime() - created.getTime()
  // A createdAt in the future is clock skew, not a fresh upload; it stays
  // inside the window rather than being treated as ancient.
  return elapsedMs < RECENT_WINDOW_HOURS * 60 * 60 * 1000
}

/** The register's own words for a Kind -- what a person reads, not the wire value. */
export function kindLabel(kind: DrawingKind): string {
  return kind === "3d_walkthrough" ? "3D Walkthrough" : "DWG"
}

/**
 * The exported register, in the item's own column order:
 * Name | Drawing No. | Kind | Discipline | Rev | Added | Link.
 *
 * Link is the row's external URL when the row IS a link, and the drawing's own
 * PROJEXA path otherwise. Deliberately NOT a signed Storage URL: the list's
 * signed URLs live 300 seconds, so a spreadsheet full of them would be broken
 * before it was read, and minting long-lived ones would put unauthenticated
 * file access into a file people forward.
 */
export const DRAWING_EXPORT_COLUMNS = ["Name", "Drawing No.", "Kind", "Discipline", "Rev", "Added", "Link"] as const

export function toDrawingExportRow(dto: DrawingDto): ExportRow {
  const added = dto.createdAt instanceof Date ? dto.createdAt : new Date(dto.createdAt)
  return {
    Name: dto.name,
    "Drawing No.": dto.drawingNo ?? "",
    Kind: kindLabel(dto.kind),
    Discipline: dto.discipline ?? "",
    Rev: dto.rev ?? "",
    Added: Number.isNaN(added.getTime()) ? String(dto.createdAt) : added.toISOString().slice(0, 10),
    Link: dto.isExternalLink && dto.documentUrl ? dto.documentUrl : `/drawings/${dto.id}`,
  }
}

export function toDrawingExportRows(dtos: DrawingDto[]): ExportRow[] {
  return dtos.map(toDrawingExportRow)
}
