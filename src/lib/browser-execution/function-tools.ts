// VERIDIAN_Architecture_v2.0 phase_5: engine-browser-function +
// engine-browser-mcp. A minimal, real, in-browser function/tool-calling
// contract the on-device AI tiers (tier-runners.ts) can invoke WITHOUT a
// server round-trip -- e.g. so a Lite LLM disambiguation call can look up
// a real capability-tree node's label instead of guessing at one.
// Deliberately distinct from ai-os/BROWSER_AUTOMATION_PROFILE_2026-07-25.yaml's
// scope (per gap analysis's explicit rejection of that file as a match for
// engine-browser-mcp): that file governs an agent's own browser session
// tooling (navigating pages, clicking, filling forms); this is a
// data/function-calling contract exposed TO an in-browser LLM tier, with
// no page-automation capability at all -- structurally the same shape as
// MCP's tool-definition contract (name/description/parameters/handler),
// but intentionally NOT a full MCP client/server (no transport, no
// capability negotiation) since every tool here already runs in the same
// JS process as its caller.
export type BrowserToolParameter = { type: "string" | "number" | "boolean"; description: string }

export type BrowserToolDefinition = {
  name: string
  description: string
  parameters: Record<string, BrowserToolParameter>
  handler: (args: Record<string, unknown>) => unknown
}

// Structural subset of veri-chat-context.tsx's own CapabilityNode -- kept
// minimal and local (not imported from that "use client" component module)
// so this src/lib module has no dependency on a specific UI surface;
// VeriComposer passes its own `tree` in unchanged.
export type MinimalCapabilityNode = { key: string; label: string; children?: MinimalCapabilityNode[] }

function findNode(nodes: MinimalCapabilityNode[], key: string): MinimalCapabilityNode | null {
  for (const node of nodes) {
    if (node.key === key) return node
    if (node.children) {
      const found = findNode(node.children, key)
      if (found) return found
    }
  }
  return null
}

/** Builds the real, callable tool registry for a given capability tree snapshot -- called fresh per composer render (the tree itself is already client-cached by veri-chat-context.tsx; this just wraps it as tool-callable functions). */
export function createBrowserToolRegistry(tree: MinimalCapabilityNode[]): BrowserToolDefinition[] {
  return [
    {
      name: "lookup_capability_node",
      description: "Look up the real display label for a capability-tree node key, so a category guess can be phrased using the system's own real terminology instead of a guessed one.",
      parameters: { key: { type: "string", description: "The capability-tree node key to look up" } },
      handler: (args) => {
        const key = typeof args.key === "string" ? args.key : ""
        const node = findNode(tree, key)
        return node ? { found: true, label: node.label } : { found: false, label: null }
      },
    },
    {
      name: "current_datetime",
      description: "Returns the current date/time, for requests that reference a relative date (e.g. 'due tomorrow').",
      parameters: {},
      handler: () => new Date().toISOString(),
    },
  ]
}
