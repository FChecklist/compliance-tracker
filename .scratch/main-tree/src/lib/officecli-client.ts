// Thin child_process wrapper around the vendored iOfficeAI/OfficeCLI binary
// (bin/officecli-linux-x64, Apache-2.0 -- github.com/iOfficeAI/OfficeCLI),
// replacing this codebase's `mammoth` docx-read dependency at its one real
// call site (ai-report-builder-service.ts's proposeReportFromUpload()).
// See ai-os/priority22_officecli_feasibility.md for the full feasibility
// evidence (checksum-verified binary, real create/edit/read smoke test,
// Vercel Node-runtime + one-shot-CLI-call fit).
//
// Security note: every argument is passed as an array element to
// child_process.execFile -- never interpolated into a shell string. This
// codebase's only external-process shell-out call site, so this boundary
// gets extra care: no shell:true, no string concatenation of user-controlled
// paths, the binary path itself is a fixed constant (never derived from
// request input).
//
// Real, session-verified CLI behavior this wrapper depends on (verified
// against the actual v1.0.136 binary, not assumed from the earlier
// feasibility pass's memory):
// - `officecli query <file> "p" --json` is a genuine one-shot, stateless
//   call -- it does NOT require a prior `open`, and it recursively matches
//   every paragraph in the document body INCLUDING paragraphs nested inside
//   table cells (confirmed with a real table fixture), matching (and
//   exceeding) mammoth.extractRawText()'s flat-text behavior. Each result
//   object's top-level `text` field is already the concatenated run text
//   for that paragraph -- no need to walk `children`.
// - Real, previously-undocumented finding: OfficeCLI keeps a background
//   "resident" process alive after ANY command touching a file (not just
//   `open`), including a bare one-shot `query` -- it does not self-exit on
//   its own within the documented "adaptive 2-10s" idle-flush window (that
//   window governs when in-memory edits are FLUSHED TO DISK, not when the
//   process itself exits). `close <file>` is the one command confirmed to
//   reliably stop it, and is idempotent/success:true even when no resident
//   is running. This wrapper always calls `close` after `query` so no
//   resident process is left behind per invocation (matters most on a warm,
//   reused Vercel container serving multiple requests).
// - `OFFICECLI_SKIP_UPDATE=1` disables the binary's background
//   update-check network call -- always set for a serverless invocation,
//   where an unexpected outbound network call or silent self-update would
//   be both non-deterministic and undesirable.
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { constants as fsConstants } from "node:fs"

const execFileAsync = promisify(execFile)

// Real Vercel/CI runtime target is Linux (Vercel Node.js serverless functions
// run on Amazon Linux; this repo's own CI runs on ubuntu-latest) -- only the
// Linux x64 binary is vendored, per the feasibility memo's "Real next steps"
// section 2.
const OFFICECLI_BIN_PATH = path.join(process.cwd(), "bin", "officecli-linux-x64")

// Generous headroom for a query's JSON output (per-paragraph/run structure,
// styles, format metadata) on a large document -- the caller truncates the
// concatenated text to MAX_EXTRACTED_CHARS afterward anyway, but the raw
// JSON before that truncation can be considerably larger than the final text.
const MAX_STDOUT_BUFFER_BYTES = 64 * 1024 * 1024

export class OfficeCliError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = "OfficeCliError"
    this.code = code
  }
}

type OfficeCliQueryResult = {
  success: boolean
  data?: {
    matches: number
    results: Array<{ path: string; type: string; text?: string }>
  }
  error?: { error: string; code?: string; suggestion?: string }
}

// Pure, platform-independent parsing step, split out from
// extractDocxRawText() so it can be unit-tested with literal JSON fixtures
// (matching real `officecli query ... --json` output captured against the
// actual binary during this task) without needing to execute the vendored
// Linux binary itself -- the dev/CI machine running this specific test may
// not be Linux even though the real integration path is (see this file's
// own .test.ts for the separate real end-to-end test, which does invoke the
// committed binary and is skipped on non-Linux platforms).
export function parseQueryResultToText(stdout: string): string {
  let parsed: OfficeCliQueryResult
  try {
    parsed = JSON.parse(stdout) as OfficeCliQueryResult
  } catch {
    throw new OfficeCliError("officecli returned non-JSON output for a docx query")
  }

  if (!parsed.success) {
    throw new OfficeCliError(parsed.error?.error ?? "officecli query failed", parsed.error?.code)
  }

  return (parsed.data?.results ?? [])
    .map((r) => (typeof r.text === "string" ? r.text : ""))
    .join("\n")
    .trim()
}

async function ensureExecutable(binPath: string): Promise<void> {
  try {
    await fs.access(binPath, fsConstants.X_OK)
  } catch {
    // Defensive, not assumed-safe: git preserves the executable bit we set
    // at commit time (`git update-index --chmod=+x`), but some CI/deploy
    // pipelines (artifact repackaging, certain container COPY layers) can
    // lose file-mode bits in transit. Re-assert it at runtime rather than
    // failing the whole request on a mode bit that should have survived but
    // might not have.
    await fs.chmod(binPath, 0o755)
  }
}

async function runOfficeCli(args: string[]): Promise<string> {
  await ensureExecutable(OFFICECLI_BIN_PATH)
  try {
    const { stdout } = await execFileAsync(OFFICECLI_BIN_PATH, args, {
      maxBuffer: MAX_STDOUT_BUFFER_BYTES,
      env: { ...process.env, OFFICECLI_SKIP_UPDATE: "1" },
    })
    return stdout
  } catch (err) {
    // execFile rejects on non-zero exit, but OfficeCLI still writes a real
    // JSON error body to stdout on failure (confirmed: file-not-found,
    // corrupt-file cases both exit 1 with a JSON `{ success: false, error }`
    // body on stdout, not stderr) -- prefer parsing that over the raw
    // execFile error when present.
    const stdout = (err as { stdout?: string }).stdout
    if (typeof stdout === "string" && stdout.trim().length > 0) return stdout
    throw new OfficeCliError(`officecli process failed to run: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Shared by extractDocxRawText/extractPptxRawText below -- the only
// difference between the two formats at this call site is the tmp file's
// extension (OfficeCLI dispatches its format handling off the file
// extension, confirmed live for both .docx and .pptx during this task).
async function extractOfficeRawText(buffer: Buffer, extension: "docx" | "pptx"): Promise<{ value: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "officecli-"))
  const tmpFile = path.join(tmpDir, `upload.${extension}`)

  try {
    await fs.writeFile(tmpFile, buffer)

    const stdout = await runOfficeCli(["query", tmpFile, "p", "--json"])

    // Always stop any resident OfficeCLI keeps warm for this file (see
    // header note) before this function returns -- best-effort, a failure
    // here should not fail the actual text-extraction result.
    try {
      await runOfficeCli(["close", tmpFile, "--json"])
    } catch {
      // best-effort cleanup only
    }

    return { value: parseQueryResultToText(stdout) }
  } finally {
    // On Linux (the real runtime target), removing a directory whose file
    // is still transiently held open by a lingering resident process
    // succeeds regardless -- unlink() removes the directory entry without
    // waiting for the last file descriptor to close. This can transiently
    // fail on Windows (dev-only, never the production/CI runtime) with
    // EBUSY if a resident hasn't exited yet; force:true + best-effort here
    // so that never surfaces as a request failure.
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Extracts raw text from a .docx buffer via the vendored OfficeCLI binary.
 * Returns a `{ value: string }` shape matching `mammoth.extractRawText()`'s
 * return value, since that is exactly what this function replaces at its
 * one real call site (ai-report-builder-service.ts's isWordDoc() branch) --
 * kept identical on purpose so the call site needs no destructuring change.
 */
export async function extractDocxRawText(buffer: Buffer): Promise<{ value: string }> {
  return extractOfficeRawText(buffer, "docx")
}

// VERIDIAN Review Framework remediation ("Supports Multiple Input Types",
// 2026-07-18): verified live against the real vendored binary before this
// was written (create pptx -> add slide -> add shape with text -> close ->
// `query <file> "p" --json`) -- the same `p` (paragraph) selector used for
// docx returns the shape's paragraph/run text at
// /slide[n]/shape[...]/paragraph[n], with the same top-level `text` field
// parseQueryResultToText() already concatenates. Real query output, not
// assumed from docx's own behavior.
export async function extractPptxRawText(buffer: Buffer): Promise<{ value: string }> {
  return extractOfficeRawText(buffer, "pptx")
}
