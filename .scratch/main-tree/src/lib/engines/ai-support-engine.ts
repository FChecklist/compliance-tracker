// VCEL AI Support Engine -- remaining engines (most of this category is
// already real infra elsewhere: prompt-os-resolver.ts, embeddings.ts,
// capability-registry-service.ts, llm-client.ts, ai-workforce-agent.mjs --
// see the registry for those implementation_refs). These two are the only
// genuinely not-yet-built pieces.

// Tool Selector -- given a set of tool names allowed for a domain (from
// purpose-bound-ai.ts's isToolAllowedForDomain) and a requested capability,
// picks the best exact/substring match. A real semantic tool-selector should
// reuse findSimilarCapabilities() (capability-registry-service.ts) rather
// than duplicate embedding infra here -- this covers the simple deterministic case.
export function selectTool(requestedCapability: string, availableTools: string[]): string | null {
  const normalized = requestedCapability.trim().toLowerCase()
  const exact = availableTools.find((t) => t.toLowerCase() === normalized)
  if (exact) return exact
  const substringMatch = availableTools.find((t) => t.toLowerCase().includes(normalized) || normalized.includes(t.toLowerCase()))
  return substringMatch ?? null
}

// Context Deduplicator -- drops near-identical consecutive lines from an LLM
// context window (exact-match on trimmed content), a cheap deterministic
// pre-pass complementary to scripts/ai-workforce-agent.mjs's
// collapseOldReadFileResults (which collapses by recency, not by content).
export function deduplicateContextLines(lines: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of lines) {
    const key = line.trim()
    if (key && seen.has(key)) continue
    seen.add(key)
    result.push(line)
  }
  return result
}
