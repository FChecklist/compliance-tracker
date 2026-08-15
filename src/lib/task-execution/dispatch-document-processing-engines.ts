// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchDocumentProcessingEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "duplicate_document_detection_engine": {
      const { detectDuplicateDocumentsByHash } = await import("@/lib/engines/document-processing-engine");
      const documents = inputs.documents as { id: string; contentHash: string }[];
      if (!Array.isArray(documents)) throw new Error("documents must be an array");
      return { duplicateGroups: detectDuplicateDocumentsByHash(documents) };
    }
  }

  return NOT_HANDLED
}
