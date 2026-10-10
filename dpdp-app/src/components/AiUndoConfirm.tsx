import "./onepage/dpdp-onepage-tokens.css"
import { useState } from "react"
import { undoAiAction, type UndoFragment } from "@/lib/api"
import type { DpdpClient } from "@/lib/client"
import type { AiActionUndoPayload } from "@/lib/rpc-types"

// WO-DPDP-013 v2 §1.2 / §4 item 6: `/app/#undo=<actionId>.<undoToken>` --
// the link a Level 1 change's undoUrl points at (POST /actions' response,
// later the Monday email). Consumed and cleared exactly like #draft=
// (readUndoFragment mirrors readDraftFragment): the hash never stays in the
// address bar or history once read. dpdp_ai_action_undo does not offer a
// preview -- what it reversed is only known once the RPC itself returns.
const VERB_LABEL: Record<AiActionUndoPayload["verb"], string> = {
  NOTE: "a note added to a job",
  SET_DUE: "a job's due date, changed",
  ASSIGN: "a job given to someone",
  MARK_NA: "a job marked not applicable",
}

export function AiUndoConfirm({ client, undo, onDone, onDismiss }: { client: DpdpClient; undo: UndoFragment; onDone: () => Promise<void>; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AiActionUndoPayload | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const r = await undoAiAction(client, undo.actionId, undo.undoToken)
      setResult(r)
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dpdp-onepage">
      <div className="max-w-[1240px] mx-auto px-5 pt-4">
        <section aria-label="Undo an AI assistant's change" className="rounded-[22px] border p-6" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-v)" }}>
          <h2 style={{ fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 700, margin: "0 0 6px", color: "var(--dpdp-ink)" }}>Undo the change your AI assistant made?</h2>
          {error && <div role="alert" className="rounded-xl px-3.5 py-2.5 mb-3" style={{ background: "var(--dpdp-rL)", color: "var(--dpdp-r)", fontSize: 13, fontWeight: 600 }}>{error}</div>}
          {result ? (
            <p role="status" style={{ fontSize: 14, fontWeight: 600, color: "var(--dpdp-g)", margin: "0 0 14px" }}>
              Undone — it reversed {VERB_LABEL[result.verb] ?? result.verb} (job {result.jobId}).
            </p>
          ) : (
            <p style={{ fontSize: 13.5, color: "var(--dpdp-ink2)", margin: "0 0 14px", maxWidth: "72ch" }}>
              An AI assistant made one small change through your AI link (action {undo.actionId}), within its 24-hour undo window. Pressing Undo reverses only that one change — nothing else.
            </p>
          )}
          <div className="flex gap-2.5 items-center flex-wrap">
            {!result && (
              <button type="button" disabled={busy} onClick={confirm} className="font-bold text-white" style={{ background: "var(--dpdp-r)", fontSize: 14, padding: "11px 18px", borderRadius: 12, opacity: busy ? 0.6 : 1 }}>
                {busy ? "Undoing…" : "Undo"}
              </button>
            )}
            <button type="button" disabled={busy} onClick={onDismiss} style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 13.5, padding: "11px 10px", textDecoration: "underline" }}>
              {result ? "Close" : "Not now"}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
