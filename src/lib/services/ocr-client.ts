// T1.2 (docs/infra/TOOL_INTEGRATION_PLAN.md): app-side entry point for the
// on-demand OCR pipeline, confirmed working end-to-end 2026-07-11 (see the
// plan doc's T1.1 status for the real, verified pipeline shape). Creates a
// tracking row, fires the repository_dispatch that runs
// .github/workflows/doc-processing-job.yml, then polls that same row until
// the GitHub Actions runner writes a result back.
//
// Each poll is its own withTenantContext call, not one held open for the
// whole wait -- withTenantContext runs inside a real DB transaction, and
// holding one open for up to 90s while sleeping would tie up a connection
// from the pool (capped at 5, tenant-scoped.ts) for no reason.
//
// Two AI Workforce dispatch attempts for this file both returned
// filesChanged: [] with no explanation -- a confirmed, reproducible
// reliability failure (not task-specific; T1.1's own dispatch succeeded).
// Self-implemented directly per the same fallback this session already used
// for z.ai dispatch failures.
import { createId } from "@paralleldrive/cuid2"
import { eq } from "drizzle-orm"
import { withTenantContext, docProcessingJobs } from "@/lib/db/tenant-scoped"

const REPO = "FChecklist/compliance-tracker"
const POLL_INTERVAL_MS = 3000
const MAX_WAIT_MS = 90_000

export type OcrResult = {
  text: string
  regions: { text: string; confidence: number; bbox: number[] }[]
  overallConfidence: number
}

async function fireDispatch(jobId: string, imageBase64: string): Promise<void> {
  const token = process.env.GITHUB_DISPATCH_PAT
  if (!token) throw new Error("GITHUB_DISPATCH_PAT is not configured -- cannot fire repository_dispatch from the app.")

  const doDispatch = async () => {
    const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "doc-processing-job",
        client_payload: { job_id: jobId, operation: "ocr", input: { image_base64: imageBase64 } },
      }),
    })
    if (!res.ok) throw new Error(`Failed to dispatch doc-processing-job: HTTP ${res.status} ${await res.text()}`)
  }

  try {
    await doDispatch()
  } catch (err) {
    // One retry on a genuine network/HTTP failure of the dispatch call
    // itself -- not a job-level failure, which is handled separately by
    // the polling loop below.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await doDispatch().catch(() => {
      throw err
    })
  }
}

export async function runOcr(input: { orgId: string; userId?: string; imageBase64: string }): Promise<OcrResult> {
  const jobId = createId()

  await withTenantContext({ orgId: input.orgId, userId: input.userId }, (tx) =>
    tx.insert(docProcessingJobs).values({
      id: jobId,
      orgId: input.orgId,
      userId: input.userId,
      operation: "ocr",
      status: "pending",
      inputRef: "inline-upload",
    })
  )

  await fireDispatch(jobId, input.imageBase64)

  const deadline = Date.now() + MAX_WAIT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

    const row = await withTenantContext({ orgId: input.orgId, userId: input.userId }, async (tx) => {
      const rows = await tx.select().from(docProcessingJobs).where(eq(docProcessingJobs.id, jobId)).limit(1)
      return rows[0]
    })

    if (!row) continue
    if (row.status === "completed") return row.result as OcrResult
    if (row.status === "failed") throw new Error(row.error ?? "OCR job failed with no error message recorded.")
  }

  throw new Error(`OCR job ${jobId} did not complete within ${MAX_WAIT_MS / 1000} seconds.`)
}
