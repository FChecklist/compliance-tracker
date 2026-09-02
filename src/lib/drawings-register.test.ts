/// <reference types="bun-types" />
// R67 D-10. The register's vocabulary, held to the item's own words: the Kind
// filter's wire values, the Discipline filter's behaviour, and the exported
// column set in the exact order the item specifies.
import { describe, expect, test } from "bun:test"
import {
  categoryFilterForKind,
  categoryForKind,
  DRAWING_EXPORT_COLUMNS,
  isDrawingCategory,
  kindForCategory,
  kindLabel,
  matchesDiscipline,
  readDrawingMetadata,
  toDrawingDto,
  toDrawingExportRows,
} from "./drawings-register"

const ADDED = new Date("2026-08-14T09:30:00.000Z")

const DWG_ROW = {
  id: "doc-1",
  name: "AR-101 Ground floor plan",
  category: "drawing",
  metadata: { discipline: "Architectural" },
  fileUrl: "org-1/abc-AR-101.dwg",
  fileType: "application/acad",
  createdAt: ADDED,
}

const LINK_ROW = {
  id: "doc-2",
  name: "Villa 21 walkthrough",
  category: "drawing_3d",
  metadata: { discipline: "MEP", isExternalLink: true },
  fileUrl: "https://my.matterport.com/show/?m=abc",
  fileType: null,
  createdAt: ADDED,
}

describe("category and kind", () => {
  test("the two drawing categories are the only ones this register admits", () => {
    expect(isDrawingCategory("drawing")).toBe(true)
    expect(isDrawingCategory("drawing_3d")).toBe(true)
    expect(isDrawingCategory("permit")).toBe(false)
    expect(isDrawingCategory(null)).toBe(false)
  })

  test("kind and category are two names for one thing, and the mapping round-trips", () => {
    expect(kindForCategory("drawing_3d")).toBe("3d_walkthrough")
    expect(kindForCategory("drawing")).toBe("dwg")
    expect(categoryForKind("3d_walkthrough")).toBe("drawing_3d")
    expect(categoryForKind("dwg")).toBe("drawing")
    expect(categoryForKind(kindForCategory("drawing_3d"))).toBe("drawing_3d")
  })

  test("an absent or unknown ?kind= means both, never an empty register", () => {
    expect(categoryFilterForKind(null)).toBeUndefined()
    expect(categoryFilterForKind("")).toBeUndefined()
    expect(categoryFilterForKind("elevation")).toBeUndefined()
    expect(categoryFilterForKind("dwg")).toBe("drawing")
    expect(categoryFilterForKind("3d_walkthrough")).toBe("drawing_3d")
  })

  test("the Kind a person reads", () => {
    expect(kindLabel("3d_walkthrough")).toBe("3D Walkthrough")
    expect(kindLabel("dwg")).toBe("DWG")
  })
})

describe("readDrawingMetadata", () => {
  test("a missing or malformed metadata blob is not a crash and not a false discipline", () => {
    expect(readDrawingMetadata(null)).toEqual({ discipline: null, isExternalLink: false })
    expect(readDrawingMetadata({ discipline: "   " })).toEqual({ discipline: null, isExternalLink: false })
    expect(readDrawingMetadata({ discipline: 42 })).toEqual({ discipline: null, isExternalLink: false })
  })

  test("isExternalLink is true only when it is literally true", () => {
    expect(readDrawingMetadata({ isExternalLink: true }).isExternalLink).toBe(true)
    expect(readDrawingMetadata({ isExternalLink: "yes" }).isExternalLink).toBe(false)
  })
})

describe("toDrawingDto", () => {
  test("shapes a stored DWG row, carrying the signed URL the route resolved", () => {
    expect(toDrawingDto(DWG_ROW, "https://signed.example/AR-101.dwg")).toEqual({
      id: "doc-1",
      name: "AR-101 Ground floor plan",
      kind: "dwg",
      discipline: "Architectural",
      isExternalLink: false,
      fileType: "application/acad",
      documentUrl: "https://signed.example/AR-101.dwg",
      createdAt: ADDED,
    })
  })

  test("a link-only 3D row keeps its own URL and is marked as external", () => {
    const dto = toDrawingDto(LINK_ROW, LINK_ROW.fileUrl)
    expect(dto.kind).toBe("3d_walkthrough")
    expect(dto.isExternalLink).toBe(true)
    expect(dto.documentUrl).toBe("https://my.matterport.com/show/?m=abc")
  })
})

describe("matchesDiscipline", () => {
  test("an absent filter keeps every row", () => {
    expect(matchesDiscipline({ discipline: "MEP" })).toBe(true)
    expect(matchesDiscipline({ discipline: null }, "")).toBe(true)
    expect(matchesDiscipline({ discipline: null }, "   ")).toBe(true)
  })

  test("the same discipline typed by two people is one discipline", () => {
    expect(matchesDiscipline({ discipline: "MEP" }, "mep")).toBe(true)
    expect(matchesDiscipline({ discipline: " Structural " }, "structural")).toBe(true)
  })

  test("a real filter excludes, including rows with no discipline at all", () => {
    expect(matchesDiscipline({ discipline: "Architectural" }, "MEP")).toBe(false)
    expect(matchesDiscipline({ discipline: null }, "MEP")).toBe(false)
  })
})

describe("toDrawingExportRows", () => {
  test("emits the item's seven columns, in the item's order", () => {
    const [row] = toDrawingExportRows([toDrawingDto(DWG_ROW, "https://signed.example/x")])
    expect(Object.keys(row)).toEqual([...DRAWING_EXPORT_COLUMNS])
  })

  test("a stored file exports its own PROJEXA path, never a 5-minute signed URL", () => {
    const [row] = toDrawingExportRows([toDrawingDto(DWG_ROW, "https://signed.example/expires-in-300s")])
    expect(row.Link).toBe("/drawings/doc-1")
    expect(row.Name).toBe("AR-101 Ground floor plan")
    expect(row.Kind).toBe("DWG")
    expect(row.Discipline).toBe("Architectural")
    expect(row.Added).toBe("2026-08-14")
  })

  test("a link row exports the link itself", () => {
    const [row] = toDrawingExportRows([toDrawingDto(LINK_ROW, LINK_ROW.fileUrl)])
    expect(row.Link).toBe("https://my.matterport.com/show/?m=abc")
    expect(row.Kind).toBe("3D Walkthrough")
  })

  test("an empty register exports no rows rather than a row of blanks", () => {
    expect(toDrawingExportRows([])).toEqual([])
  })
})
