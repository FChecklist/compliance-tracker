import "./onepage/dpdp-onepage-tokens.css"
import { useEffect, useState } from "react"
import { aiDraftPreview, confirmAiDraft, type DraftFragment } from "@/lib/api"
import type { DpdpClient } from "@/lib/client"
import type { AiDraftPreviewPayload } from "@/lib/rpc-types"

// WO-DPDP-012 §7: `/app/#draft=<draftId>.<confirmToken>` -- the URL the AI
// link's reader hands back after drafting one of the five verbs. The
// fragment was read and cleared on load (readDraftFragment); this shows
// dpdp_ai_draft_preview and applies the draft ONLY on Confirm
// (dpdp_confirm_ai_draft, under the signed-in person's own authority --
// the RPC refuses anyone but the link's own membership). Until Confirm,
// nothing in the org has changed.
const VERB_LABEL: Record<AiDraftPreviewPayload["verb"], string> = {
  ASSIGN: "Give a job to someone",
  SET_DUE: "Change when a job is due",
  NOTE: "Add a note to a job",
  MARK_NA: "Mark a job as not applicable",
  DRAFT: "Draft a document",
  // WO-DPDP-013 Part 1 (drizzle/0610): the Level 2 verbs. Only the first
  // three execute on Confirm today (dpdp_confirm_ai_draft); the rest are
  // recorded as drafts and the RPC refuses Confirm with a plain sentence --
  // shown here BEFORE the button so nobody presses Confirm for nothing.
  MARK_DONE: "Mark a job done",
  OWNER_CONFIRM: "Confirm the list your CA set up",
  ADD_PERSON: "Add a person by giving them a job",
  MANAGER_CHECK: "CA manager checks the file",
  PARTNER_SIGN: "CA partner signs the file",
  DELETE: "Delete a job",
  REMOVE_PERSON: "Remove a person from a job",
  CHANGE_SIGNER: "Change who signs",
  PUBLISH: "Publish",
  EXPORT_PERSONAL_DATA: "Export personal data",
}
const EXECUTABLE_ON_CONFIRM = new Set<AiDraftPreviewPayload["verb"]>(["ASSIGN", "SET_DUE", "NOTE", "MARK_NA", "DRAFT", "MARK_DONE", "OWNER_CONFIRM", "ADD_PERSON"])
const FIELD_LABEL: Record<string, string> = { email: "To", dueOn: "Due on", text: "Note", reason: "Reason", docKind: "Document" }

export function DraftConfirm({ client, draft, onDone, onDismiss }: { client: DpdpClient; draft: DraftFragment; onDone: () => Promise<void>; onDismiss: () => void }) {
  const [preview, setPreview] = useState<AiDraftPreviewPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    let cancelled = false
    aiDraftPreview(client, draft.draftId, draft.confirmToken).then(
      (p) => { if (!cancelled) setPreview(p) },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [client, draft])

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await confirmAiDraft(client, draft.draftId, draft.confirmToken)
      setConfirmed(true)
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const fields = preview ? Object.entries(preview.payload ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "") : []
  const done = confirmed || !!preview?.confirmedAt
  const executable = !preview || EXECUTABLE_ON_CONFIRM.has(preview.verb)

  return (
    <div className="dpdp-onepage">
      <div className="max-w-[1240px] mx-auto px-5 pt-4">
        <section aria-label="An AI drafted something for you to confirm" className="rounded-[22px] border p-6" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-v)" }}>
          <h2 style={{ fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 700, margin: "0 0 6px", color: "var(--dpdp-ink)" }}>🤖 An AI drafted something for you to confirm</h2>
          {error && <div role="alert" className="rounded-xl px-3.5 py-2.5 mb-3" style={{ background: "var(--dpdp-rL)", color: "var(--dpdp-r)", fontSize: 13, fontWeight: 600 }}>{error}</div>}
          {!preview && !error && <p style={{ fontSize: 14, color: "var(--dpdp-ink3)", margin: 0 }}>Loading the draft…</p>}
          {preview && (
            <>
              <dl className="grid gap-x-4 gap-y-1.5 mb-4" style={{ gridTemplateColumns: "max-content 1fr", fontSize: 14 }}>
                <dt style={{ color: "var(--dpdp-ink3)" }}>What</dt><dd style={{ margin: 0 }}><b>{VERB_LABEL[preview.verb] ?? preview.verb}</b></dd>
                {preview.job && <><dt style={{ color: "var(--dpdp-ink3)" }}>Job</dt><dd style={{ margin: 0 }}>{preview.job}</dd></>}
                {fields.map(([k, v]) => (
                  <span key={k} className="contents">
                    <dt style={{ color: "var(--dpdp-ink3)" }}>{FIELD_LABEL[k] ?? k}</dt><dd style={{ margin: 0 }}>{String(v)}</dd>
                  </span>
                ))}
                <dt style={{ color: "var(--dpdp-ink3)" }}>For</dt><dd style={{ margin: 0 }}>{preview.org.name}</dd>
              </dl>
              {done ? (
                <p role="status" style={{ fontSize: 14, fontWeight: 600, color: "var(--dpdp-g)", margin: "0 0 10px" }}>Confirmed — History records &ldquo;drafted by AI, confirmed by you&rdquo;.</p>
              ) : preview.expired ? (
                <p role="alert" style={{ fontSize: 14, fontWeight: 600, color: "var(--dpdp-r)", margin: "0 0 10px" }}>This draft has expired — ask the AI for a fresh one. Nothing has changed.</p>
              ) : !executable ? (
                <p role="alert" style={{ fontSize: 14, fontWeight: 600, color: "var(--dpdp-ink2)", margin: "0 0 10px", maxWidth: "72ch" }}>
                  This kind of draft cannot be confirmed here yet — do it on your page. It is recorded so you know the AI asked. Nothing has changed.
                </p>
              ) : (
                <p style={{ fontSize: 13.5, color: "var(--dpdp-ink2)", margin: "0 0 14px", maxWidth: "72ch" }}>
                  Nothing has changed yet. It only happens if you press Confirm — under your name, not the AI&rsquo;s.
                </p>
              )}
              <div className="flex gap-2.5 items-center flex-wrap">
                {!done && !preview.expired && executable && (
                  <button type="button" disabled={busy} onClick={confirm} className="font-bold text-white" style={{ background: "var(--dpdp-g)", fontSize: 14, padding: "11px 18px", borderRadius: 12, opacity: busy ? 0.6 : 1 }}>
                    {busy ? "Confirming…" : "Confirm"}
                  </button>
                )}
                <button type="button" disabled={busy} onClick={onDismiss} style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 13.5, padding: "11px 10px", textDecoration: "underline" }}>
                  {done ? "Close" : "Not now"}
                </button>
              </div>
            </>
          )}
          {error && !preview && (
            <button type="button" onClick={onDismiss} style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 13.5, padding: "11px 10px", textDecoration: "underline" }}>Close</button>
          )}
        </section>
      </div>
    </div>
  )
}
