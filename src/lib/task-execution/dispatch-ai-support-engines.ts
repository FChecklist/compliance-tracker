// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchAiSupportEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "tool_selector_engine": {
      const { selectTool } = await import("@/lib/engines/ai-support-engine");
      const availableTools = inputs.availableTools as string[];
      if (!Array.isArray(availableTools)) throw new Error("availableTools must be an array");
      return { selectedTool: selectTool(String(inputs.requestedCapability ?? ""), availableTools) };
    }
    case "context_deduplicator_engine": {
      const { deduplicateContextLines } = await import("@/lib/engines/ai-support-engine");
      const lines = inputs.lines as string[];
      if (!Array.isArray(lines)) throw new Error("lines must be an array of strings");
      return { deduplicatedLines: deduplicateContextLines(lines) };
    }
  }

  return NOT_HANDLED
}
