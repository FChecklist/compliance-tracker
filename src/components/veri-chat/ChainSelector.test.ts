/// <reference types="bun-types" />
// Priority 6 item 1 (VERI_CHAT_GOVERNANCE.md §5, "Chain Selector UI for new
// conversations"): tests the pure, non-React helper functions that moved
// out of VeriComposer.tsx into this shared module (pathSegmentDisplay,
// pathDisplayString, nodeChildrenAt, expandPathsForSend) plus the resolution
// logic ChainSelectorDialog uses to turn a selectedPath into
// {modePill, pathKeys}. Matches this repo's established pattern of testing
// the pure predicate/derivation functions a component delegates to rather
// than rendering the component itself (no .test.tsx precedent exists in
// this codebase -- see task-service.test.ts, chat-service.test.ts).
import { describe, expect, test } from "bun:test"
import { pathSegmentDisplay, pathDisplayString, nodeChildrenAt, expandPathsForSend } from "./ChainSelector"
import type { CapabilityNode, PathSegment } from "./veri-chat-context"

describe("pathSegmentDisplay", () => {
  test("returns a plain string segment unchanged", () => {
    expect(pathSegmentDisplay("compliance_item")).toBe("compliance_item")
  })

  test("renders a multi-select segment as bracketed, +-joined values", () => {
    expect(pathSegmentDisplay({ multi: true, values: ["CustomerA", "CustomerB"] })).toBe("[CustomerA + CustomerB]")
  })
})

describe("pathDisplayString", () => {
  test("joins segments with a hyphen", () => {
    const path: PathSegment[] = ["compliance_item", "mark_completed"]
    expect(pathDisplayString(path)).toBe("compliance_item-mark_completed")
  })

  test("empty path renders as empty string", () => {
    expect(pathDisplayString([])).toBe("")
  })

  test("mixes plain and multi segments correctly", () => {
    const path: PathSegment[] = ["customers", { multi: true, values: ["A", "B"] }]
    expect(pathDisplayString(path)).toBe("customers-[A + B]")
  })
})

describe("expandPathsForSend", () => {
  test("a path with no multi segment expands to exactly itself", () => {
    const path: PathSegment[] = ["tasks", "compliance_item", "mark_completed"]
    expect(expandPathsForSend(path)).toEqual([path])
  })

  test("a multi segment fans out into one concrete path per value", () => {
    const path: PathSegment[] = ["customers", { multi: true, values: ["A", "B", "C"] }]
    expect(expandPathsForSend(path)).toEqual([
      ["customers", "A"],
      ["customers", "B"],
      ["customers", "C"],
    ])
  })

  test("the first expansion (used by ChainSelectorDialog for a single new-conversation chain) is deterministic", () => {
    const path: PathSegment[] = ["customers", { multi: true, values: ["Zeta", "Alpha"] }]
    const [first] = expandPathsForSend(path)
    expect(first).toEqual(["customers", "Zeta"])
  })
})

describe("nodeChildrenAt", () => {
  const tree: CapabilityNode[] = [
    {
      key: "compliance", label: "Compliance", leaf: false,
      children: [
        { key: "mark_completed", label: "Mark completed", leaf: true },
        { key: "escalate", label: "Escalate", leaf: false, children: [
          { key: "to_manager", label: "To manager", leaf: true },
        ] },
      ],
    },
    { key: "tasks", label: "Tasks", leaf: false, children: [] },
  ]

  test("depth 0 (empty path) returns the root tree as the next row's options", () => {
    expect(nodeChildrenAt(tree, [], 0).children).toEqual(tree)
  })

  test("descends one level into a matched non-leaf node's children", () => {
    const result = nodeChildrenAt(tree, ["compliance"], 1)
    expect(result.children).toEqual(tree[0].children!)
  })

  test("descends two levels through nested non-leaf nodes", () => {
    const result = nodeChildrenAt(tree, ["compliance", "escalate"], 2)
    expect(result.children).toEqual([{ key: "to_manager", label: "To manager", leaf: true }])
  })

  test("returns null once the path has reached a leaf (chain complete)", () => {
    const result = nodeChildrenAt(tree, ["compliance", "mark_completed"], 2)
    expect(result.children).toBeNull()
  })

  test("returns null for a path segment that doesn't match any node (defensive)", () => {
    const result = nodeChildrenAt(tree, ["does_not_exist"], 1)
    expect(result.children).toBeNull()
  })

  test("resolves a multi-select segment as the union of each value's children", () => {
    const multiTree: CapabilityNode[] = [
      { key: "a", label: "A", leaf: false, children: [{ key: "x", label: "X", leaf: true }] },
      { key: "b", label: "B", leaf: false, children: [{ key: "y", label: "Y", leaf: true }] },
    ]
    const result = nodeChildrenAt(multiTree, [{ multi: true, values: ["a", "b"] }], 1)
    expect(result.children).toEqual([
      { key: "x", label: "X", leaf: true },
      { key: "y", label: "Y", leaf: true },
    ])
  })
})
