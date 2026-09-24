import "./onepage/dpdp-onepage-tokens.css"
import { useEffect, useState } from "react"
import { aiLinkUrl, aiLinkWarning, createAiWorkLink, listAiLinks, revokeAiLink } from "@/lib/api"
import { LEVEL1_EXPLANATION, LEVEL_LABEL, aiWorkLinkWarningSentence, formatEnInDate } from "@/lib/ai-work-link"
import type { DpdpClient } from "@/lib/client"
import type { AiLinkListItem, AiLinkWarning, AiWorkLinkCreated } from "@/lib/rpc-types"

// WO-DPDP-013 v2 §4 item 6: "The Copy-AI-link screen with the data warning".
// Replaces AiLinkButton.tsx (the single read-only 0607 link, shown once)
// with the full drizzle/0610 contract: the warning sentence with real
// counts, authority levels (0 always on, 1 off by default, its own plain
// explanation on switch-on), hide-other-emails, a 1/7/30-day expiry choice,
// an optional label, the token shown exactly once, and "Your AI links" with
// revoke. The token itself never sits in this file's state after the person
// navigates away -- src/lib/api.ts's createAiWorkLink is the only place it
// is ever read from the wire.
const card = { background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" } as const
const alertStyle = { background: "var(--dpdp-rL)", color: "var(--dpdp-r)", fontSize: 13, fontWeight: 600 } as const
const fieldLabel = { fontSize: 13, fontWeight: 600, color: "var(--dpdp-ink2)", display: "block", marginBottom: 4 } as const
const fieldInput = { padding: "11px 13px", border: "1px solid var(--dpdp-line)", borderRadius: 12, fontSize: 14, background: "#fff" } as const

export function AiWorkLink({ client, orgId, onMade }: { client: DpdpClient; orgId: string; onMade?: () => Promise<void> }) {
  const [warning, setWarning] = useState<AiLinkWarning | null>(null)
  const [warningError, setWarningError] = useState<string | null>(null)
  const [hideEmails, setHideEmails] = useState(false)
  const [days, setDays] = useState<1 | 7 | 30>(7)
  const [labelText, setLabelText] = useState("")
  const [level1, setLevel1] = useState(false)
  const [created, setCreated] = useState<AiWorkLinkCreated | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [links, setLinks] = useState<AiLinkListItem[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  // Initial load: state is set inline in the .then callbacks, not by calling
  // out to a shared function -- eslint-plugin-react-hooks' set-state-in-effect
  // rule flags an effect that merely calls a local function which itself
  // sets state (even asynchronously), the same reason History's own effect
  // (src/components/onepage/Timeline.tsx's caller) is written this way.
  // refreshWarning/refreshList below are the reusable versions, used only
  // from event handlers (make/revoke/makeAnother), never from an effect.
  useEffect(() => {
    let cancelled = false
    aiLinkWarning(client, orgId).then(
      (w) => { if (!cancelled) { setWarning(w); setWarningError(null) } },
      (e) => { if (!cancelled) setWarningError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [client, orgId])
  useEffect(() => {
    let cancelled = false
    listAiLinks(client, orgId).then(
      (l) => { if (!cancelled) { setLinks(l); setListError(null) } },
      (e) => { if (!cancelled) setListError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [client, orgId])

  async function refreshWarning() {
    try {
      const w = await aiLinkWarning(client, orgId)
      setWarning(w)
      setWarningError(null)
    } catch (e) {
      setWarningError(e instanceof Error ? e.message : String(e))
    }
  }
  async function refreshList() {
    try {
      const l = await listAiLinks(client, orgId)
      setLinks(l)
      setListError(null)
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e))
    }
  }

  async function make() {
    setBusy(true)
    setError(null)
    try {
      const link = await createAiWorkLink(client, { level: level1 ? 1 : 0, hideEmails, days, label: labelText.trim() || null, orgId })
      setCreated(link)
      try {
        await navigator.clipboard.writeText(aiLinkUrl(link.token))
        setCopied(true)
        setTimeout(() => setCopied(false), 2200)
      } catch {
        // the Copy button below still works -- clipboard access can be
        // blocked (permissions, non-HTTPS in dev, an automated driver)
      }
      await refreshList()
      await onMade?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(aiLinkUrl(created.token))
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      setError("Could not copy — select the link and copy it by hand.")
    }
  }

  function makeAnother() {
    setCreated(null)
    setCopied(false)
    setError(null)
    setLabelText("")
    void refreshWarning()
  }

  async function revoke(id: string) {
    await revokeAiLink(client, id)
    await refreshList()
  }

  return (
    <div className="dpdp-onepage">
      <div className="max-w-[1240px] mx-auto px-5 pb-6">
        <div className="rounded-[22px] border p-6" style={card}>
          <h2 style={{ fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 700, margin: "0 0 6px", color: "var(--dpdp-ink)" }}>🤖 AI work link</h2>
          {warningError && <div role="alert" className="rounded-xl px-3.5 py-2.5 mb-3" style={alertStyle}>{warningError}</div>}
          {error && <div role="alert" className="rounded-xl px-3.5 py-2.5 mb-3" style={alertStyle}>{error}</div>}
          {!created ? (
            <>
              {warning ? (
                <p style={{ fontSize: 14, color: "var(--dpdp-ink2)", margin: "0 0 16px", maxWidth: "72ch" }}>{aiWorkLinkWarningSentence(warning)}</p>
              ) : (
                !warningError && <p style={{ fontSize: 13, color: "var(--dpdp-ink3)", margin: "0 0 16px" }}>Loading…</p>
              )}

              <label className="inline-flex gap-1.5 items-center cursor-pointer" style={{ fontSize: 14, color: "var(--dpdp-ink)" }}>
                <input type="checkbox" checked={hideEmails} onChange={(e) => setHideEmails(e.target.checked)} disabled={busy} />
                Hide other people&rsquo;s emails (show their role instead)
              </label>

              <div className="flex gap-3.5 flex-wrap items-end mt-3.5 mb-3.5">
                <div>
                  <label htmlFor="ai-link-days" style={fieldLabel}>Link lasts</label>
                  <select id="ai-link-days" value={days} onChange={(e) => setDays(Number(e.target.value) as 1 | 7 | 30)} disabled={busy} style={fieldInput}>
                    <option value={1}>1 day</option>
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </div>
                <div style={{ minWidth: 220 }}>
                  <label htmlFor="ai-link-label" style={fieldLabel}>Label (optional)</label>
                  <input
                    id="ai-link-label" type="text" value={labelText} onChange={(e) => setLabelText(e.target.value)} disabled={busy}
                    placeholder="e.g. ChatGPT, September" style={{ ...fieldInput, width: "100%" }}
                  />
                </div>
              </div>

              <div className="rounded-xl p-4 mb-3.5" style={{ background: "var(--dpdp-line2)" }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--dpdp-ink)", marginBottom: 6 }}>What this AI may do</div>
                <div style={{ fontSize: 13.5, color: "var(--dpdp-ink2)", marginBottom: 8 }}>✓ {LEVEL_LABEL[0]} — always on</div>
                <label className="inline-flex gap-1.5 items-center cursor-pointer" style={{ fontSize: 13.5, color: "var(--dpdp-ink)" }}>
                  <input type="checkbox" checked={level1} onChange={(e) => setLevel1(e.target.checked)} disabled={busy} />
                  {LEVEL_LABEL[1]}
                </label>
                {level1 && <p style={{ fontSize: 12.5, color: "var(--dpdp-ink2)", margin: "8px 0 0", maxWidth: "68ch" }}>{LEVEL1_EXPLANATION}</p>}
              </div>

              <button
                type="button" disabled={busy || !warning} onClick={make} className="font-bold text-white rounded-lg"
                style={{ background: "var(--dpdp-v)", fontSize: 13, padding: "9px 16px", opacity: busy || !warning ? 0.6 : 1 }}
              >
                {busy ? "Making…" : "Copy link"}
              </button>
            </>
          ) : (
            <>
              <div className="rounded-xl border px-3.5 py-3 mb-2 font-mono break-all" style={{ borderColor: "var(--dpdp-line)", background: "#fff", fontSize: 12.5, color: "var(--dpdp-v)" }}>
                {aiLinkUrl(created.token)}
              </div>
              <div className="flex gap-3 items-center flex-wrap mb-2">
                <button type="button" onClick={copy} className="font-bold text-white rounded-lg" style={{ background: "var(--dpdp-v)", fontSize: 13, padding: "9px 16px" }}>
                  {copied ? "✓ Copied" : "📋 Copy"}
                </button>
                <span style={{ fontSize: 12.5, color: "var(--dpdp-ink3)" }}>{LEVEL_LABEL[created.level]} · expires {formatEnInDate(created.expiresAt)}</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--dpdp-ink2)", margin: "0 0 6px", maxWidth: "72ch" }}>
                Shown once — never stored in a way that could be shown again. Copy it now.
              </p>
              <p style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", margin: "0 0 14px" }}>This is written to your History as &ldquo;Made an AI link&rdquo;.</p>
              <button type="button" onClick={makeAnother} style={{ background: "transparent", color: "var(--dpdp-v)", fontSize: 13, padding: "4px 0", textDecoration: "underline" }}>
                Make another link
              </button>
            </>
          )}
        </div>
      </div>
      <AiLinksList links={links} error={listError} onRevoke={revoke} />
    </div>
  )
}

function AiLinksList({ links, error, onRevoke }: { links: AiLinkListItem[] | null; error: string | null; onRevoke: (id: string) => Promise<void> }) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  async function confirmRevoke(id: string) {
    setBusyId(id)
    setRowError(null)
    try {
      await onRevoke(id)
      setConfirmingId(null)
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="max-w-[1240px] mx-auto px-5 pb-14">
      <h3 style={{ fontFamily: "Sora, sans-serif", fontSize: 17, fontWeight: 700, margin: "0 0 10px", color: "var(--dpdp-ink)" }}>Your AI links</h3>
      {error && <div role="alert" className="rounded-xl px-3.5 py-2.5 mb-3" style={alertStyle}>{error}</div>}
      {rowError && <div role="alert" className="rounded-xl px-3.5 py-2.5 mb-3" style={alertStyle}>{rowError}</div>}
      {!links ? (
        <p style={{ fontSize: 13, color: "var(--dpdp-ink3)" }}>Loading…</p>
      ) : links.length === 0 ? (
        <div className="rounded-2xl border p-4" style={{ ...card, color: "var(--dpdp-ink3)", fontSize: 13.5 }}>No AI link yet.</div>
      ) : (
        <div className="rounded-[22px] border overflow-hidden" style={card}>
          {links.map((l, i) => {
            const status = l.revokedAt ? "Revoked" : !l.active ? "Expired" : null
            return (
              <div
                key={l.id} className="flex justify-between items-center gap-3 flex-wrap p-3.5"
                style={{ borderTop: i ? "1px solid var(--dpdp-line2)" : undefined, opacity: status ? 0.6 : 1 }}
              >
                <div>
                  <b style={{ fontSize: 14, color: "var(--dpdp-ink)" }}>{l.label || "AI link"}</b>
                  <div style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", marginTop: 2 }}>
                    {LEVEL_LABEL[l.level]} · made {formatEnInDate(l.createdAt)} · expires {formatEnInDate(l.expiresAt)}
                    {l.hideEmails ? " · hidden emails" : ""} · {l.callCount} call{l.callCount === 1 ? "" : "s"}
                  </div>
                </div>
                {status ? (
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dpdp-ink3)" }}>{status}</span>
                ) : confirmingId === l.id ? (
                  <div className="flex gap-2 items-center flex-wrap">
                    <span style={{ fontSize: 12.5, color: "var(--dpdp-r)", fontWeight: 600 }}>Stop this link? The AI using it will be refused from its next call.</span>
                    <button
                      type="button" disabled={busyId === l.id} onClick={() => confirmRevoke(l.id)} className="font-bold text-white rounded-lg"
                      style={{ background: "var(--dpdp-r)", fontSize: 12.5, padding: "7px 12px", opacity: busyId === l.id ? 0.6 : 1 }}
                    >
                      {busyId === l.id ? "Stopping…" : "Yes, stop it"}
                    </button>
                    <button type="button" disabled={busyId === l.id} onClick={() => setConfirmingId(null)} style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 12.5, textDecoration: "underline" }}>
                      Never mind
                    </button>
                  </div>
                ) : (
                  <button
                    type="button" onClick={() => setConfirmingId(l.id)} aria-label={`Revoke ${l.label || "AI link"}`}
                    style={{ background: "transparent", color: "var(--dpdp-r)", fontSize: 12.5, fontWeight: 600, padding: "6px 8px", textDecoration: "underline" }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
