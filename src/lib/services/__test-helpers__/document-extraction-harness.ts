// PROJEXA-BUILD-002 WP-02: the harness of the model-route tests that need no database. The real Edge Function handler runs in
// process behind an EdgeCaller with the given stand-in model, the ledger is the in-memory double, and createProject() and createBoq()
// are spies that record what they were given and can write nowhere. `outcome()` runs createProjectFromDocument() and returns either
// its result or the refusal, with the spy counts.
import {
  createProjectFromDocument,
  type CreateFromDocumentDeps,
  type CreateFromDocumentInput,
  type CreateFromDocumentResult,
} from "../document-extraction-service"
import { ExtractionRejectedError } from "../document-extraction-schema"
import type { ModelCall } from "../../../../supabase/functions/projexa-document-extract/handler"
import { edgeCallerFor, edgeDeps, memoryLedger } from "./document-extraction-fixtures"

export const HARNESS_INPUT = { orgId: "org-1", actorId: "person-1", productId: "product-1", fileName: "book.xlsx" }

export type CreatedProject = { name?: string; description?: string; productId?: string; startDate?: string; targetDate?: string }
export type CreatedLine = { itemCode?: string; description: string; unit: string; quantity: number; rate: number; category?: string; parentItemCode?: string }

export function harness(model: ModelCall | null, memory: ReturnType<typeof memoryLedger> = memoryLedger()) {
  const calls = { createProject: 0, createBoq: 0 }
  const created: { project: CreatedProject | null; title: string | null; lines: CreatedLine[] } = { project: null, title: null, lines: [] }
  const caller = edgeCallerFor(edgeDeps(model))
  const deps = {
    callEdge: caller,
    ledger: memory.ledger,
    createProject: async (_ctx: unknown, input: CreatedProject) => {
      calls.createProject++
      created.project = input
      return { id: "project-1" }
    },
    createBoq: async (_ctx: unknown, input: { title: string; lineItems: CreatedLine[] }) => {
      calls.createBoq++
      created.title = input.title
      created.lines = input.lineItems
      return { id: "boq-1" }
    },
  } as unknown as CreateFromDocumentDeps<{ id: string }, { id: string }>
  return { deps, calls, created, caller, ...memory }
}

export type Harness = ReturnType<typeof harness>

/** Runs the create path once. `error` is the ExtractionRejectedError when it refused, null otherwise. */
export async function outcome(
  h: Harness,
  bytes: Uint8Array,
  extra: Partial<CreateFromDocumentInput> = {},
): Promise<{ result: CreateFromDocumentResult<{ id: string }, { id: string }> | null; error: ExtractionRejectedError | null }> {
  try {
    const result = await createProjectFromDocument({ ...HARNESS_INPUT, bytes, ...extra }, h.deps)
    return { result, error: null }
  } catch (e) {
    if (e instanceof ExtractionRejectedError) return { result: null, error: e }
    throw e
  }
}
