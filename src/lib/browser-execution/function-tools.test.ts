import { describe, expect, test } from "bun:test";
import { createBrowserToolRegistry, type MinimalCapabilityNode } from "./function-tools";

const TREE: MinimalCapabilityNode[] = [
  { key: "tasks", label: "Tasks", children: [{ key: "compliance", label: "Compliance Items" }] },
  { key: "discuss", label: "Discuss" },
];

describe("createBrowserToolRegistry", () => {
  test("registers the expected tool names", () => {
    const registry = createBrowserToolRegistry(TREE);
    expect(registry.map((t) => t.name).sort()).toEqual(["current_datetime", "lookup_capability_node"]);
  });

  test("lookup_capability_node finds a top-level node", () => {
    const registry = createBrowserToolRegistry(TREE);
    const tool = registry.find((t) => t.name === "lookup_capability_node")!;
    expect(tool.handler({ key: "discuss" })).toEqual({ found: true, label: "Discuss" });
  });

  test("lookup_capability_node finds a nested node", () => {
    const registry = createBrowserToolRegistry(TREE);
    const tool = registry.find((t) => t.name === "lookup_capability_node")!;
    expect(tool.handler({ key: "compliance" })).toEqual({ found: true, label: "Compliance Items" });
  });

  test("lookup_capability_node reports not-found for an unknown key", () => {
    const registry = createBrowserToolRegistry(TREE);
    const tool = registry.find((t) => t.name === "lookup_capability_node")!;
    expect(tool.handler({ key: "nonexistent" })).toEqual({ found: false, label: null });
  });

  test("current_datetime returns a parseable ISO string", () => {
    const registry = createBrowserToolRegistry(TREE);
    const tool = registry.find((t) => t.name === "current_datetime")!;
    const result = tool.handler({}) as string;
    expect(Number.isNaN(Date.parse(result))).toBe(false);
  });
});
