import "./onepage/dpdp-onepage-tokens.css"
import { useCallback, useEffect, useState, type FormEvent } from "react"
import { addEvidence, closeErasure, closeRequest, fetchEvidencePack, fetchProveOverview, logBreach, logErasure, logRequest, signOffIcpStage, updateBreach, withdrawEvidence } from "@/lib/api"
import type { DpdpClient } from "@/lib/client"
import { looksLikePerson } from "@/lib/icp"
import {
  EVIDENCE_LABEL, EVIDENCE_NOTE, OUTCOME_LABEL, PROVE_PROMISE, REQUEST_LABEL, TRIGGER_LABEL, VIA_LABEL, niceDate, packToHtml, sha256Hex, shortHash,
  type ArrivedVia, type BreachWire, type ErasureTrigger, type EvidenceKind, type ProveOverview, type RequestOutcome, type RequestType,
} from "@/lib/icp-prove"

// PROVE, the third step of the weekly routine: keep the records that show what you did (drizzle/0762). Everything shown is read from the database.
// We record what the organisation tells us; we never call a record verified, compliant or certified, and no person's name, e-mail or phone goes in.
const btn = { background: "var(--dpdp-v)", fontSize: 14, padding: "8px 14px" } as const
const ghost = { fontSize: 13.5, padding: "6px 12px", border: "1px solid var(--dpdp-line)", background: "#fff", color: "var(--dpdp-ink)" } as const
const field = { fontSize: 14, padding: "6px 8px", border: "1px solid var(--dpdp-line)", borderRadius: 8, background: "#fff", color: "var(--dpdp-ink)", maxWidth: "100%" } as const
const h3 = { fontFamily: "Sora, sans-serif", fontSize: 17, fontWeight: 700, margin: "0 0 4px", color: "var(--dpdp-ink)" } as const
const hint = { fontSize: 13.5, color: "var(--dpdp-ink2)", margin: "0 0 8px", maxWidth: "76ch" } as const
const late = { color: "#8a1c1c", fontWeight: 700 } as const

export function ProvePanel({ client, orgId, offline, onChanged }: { client: DpdpClient; orgId: string; offline: boolean; onChanged: () => void | Promise<void> }) {
  const [ov, setOv] = useState<ProveOverview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [forItem, setForItem] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(async () => {
    try { setOv(await fetchProveOverview(client, orgId)); setProblem(null) } catch (e) { setProblem(e instanceof Error ? e.message : "We could not read your records just now. Try again in a moment.") }
  }, [client, orgId])
  // Initial load: state is set inline in the callbacks (the react-hooks set-state-in-effect rule flags an effect that only calls a local function that sets state);
  // `load` above is for event handlers only.
  useEffect(() => {
    let cancelled = false
    fetchProveOverview(client, orgId).then(
      (o) => { if (!cancelled) { setOv(o); setProblem(null) } },
      (e) => { if (!cancelled) setProblem(e instanceof Error ? e.message : "We could not read your records just now. Try again in a moment.") },
    )
    return () => { cancelled = true }
  }, [client, orgId])

  async function run(what: () => Promise<string | void>) {
    setBusy(true); setProblem(null); setNote(null)
    try { const m = await what(); if (m) setNote(m); await load(); await onChanged() } catch (e) { setProblem(e instanceof Error ? e.message : "That did not work. Nothing was changed.") } finally { setBusy(false) }
  }
  const disabled = busy || offline

  async function openPack(asJson: boolean) {
    await run(async () => {
      const pack = await fetchEvidencePack(client, orgId)
      const blob = new Blob([asJson ? JSON.stringify(pack, null, 2) : packToHtml(pack)], { type: asJson ? "application/json" : "text/html" })
      const url = URL.createObjectURL(blob)
      if (asJson) { const a = document.createElement("a"); a.href = url; a.download = `evidence-pack-${pack.weekStart}.json`; a.click() } else window.open(url, "_blank", "noopener")
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return asJson ? "The pack was downloaded." : "The pack opened in a new tab. Use Print there to print it or save it as a PDF."
    })
  }

  return (
    <div className="mt-8" id="icp-prove" data-testid="icp-prove">
      <h3 style={{ ...h3, fontSize: 18 }}>Prove: your records</h3>
      <p style={hint}>{PROVE_PROMISE} What you record here is your own record of what happened and when.</p>
      {problem && <p role="alert" style={{ fontSize: 14, color: "#8a1c1c", margin: "0 0 10px" }}>{problem}</p>}
      {note && <p role="status" style={{ fontSize: 14, color: "var(--dpdp-g, #0B5F26)", margin: "0 0 10px" }}>{note}</p>}
      {!ov ? <p style={{ fontSize: 13 }}>Loading…</p> : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
          <Evidence ov={ov} disabled={disabled} forItem={forItem} clearItem={() => setForItem(null)}
            onAdd={(i) => run(async () => { await addEvidence(client, orgId, i); setForItem(null); return "Recorded." })}
            onWithdraw={(id, why) => run(async () => { await withdrawEvidence(client, orgId, id, why); return "Withdrawn. The line stays on the record, marked withdrawn." })}
            onNothing={() => run(async () => { await signOffIcpStage(client, orgId, "prove", "Nothing to attach this week", "skipped"); return "Recorded: nothing to attach this week." })} />
          <Helpers ov={ov} disabled={disabled} onAttach={(v) => { setForItem(v); document.getElementById("icp-evidence-form")?.scrollIntoView?.({ block: "center" }) }} />
          <Breaches ov={ov} disabled={disabled}
            onLog={(i) => run(async () => { await logBreach(client, orgId, i); return "Recorded. The 72-hour clock for the report to the Board is on the record." })}
            onStep={(id, u, msg) => run(async () => { await updateBreach(client, orgId, id, u); return msg })} />
          <Requests ov={ov} disabled={disabled}
            onLog={(i) => run(async () => { const r = await logRequest(client, orgId, i); return `Logged as ${r.ref}. Reply by ${niceDate(r.dueOn)} at the latest.` })}
            onClose={(ref, o) => run(async () => { await closeRequest(client, orgId, ref, o); return "Marked answered." })} />
          <Erasure ov={ov} disabled={disabled}
            onLog={(i) => run(async () => { await logErasure(client, orgId, i); return "Logged." })}
            onClose={(id, i) => run(async () => { await closeErasure(client, orgId, id, i); return "Closed." })} />
          <section className="rounded-2xl border p-4" style={{ borderColor: "var(--dpdp-line)", background: "#fff" }} aria-labelledby="icp-pack-h">
            <h4 id="icp-pack-h" style={h3}>Evidence pack</h4>
            <p style={hint}>One page with your register, records, notices, consent counts, breaches, requests, agreements, erasures, jobs, the weekly record and a check of the History. It holds no person&apos;s name, e-mail or phone. It lists what you recorded; it is not a certificate.</p>
            <div className="flex gap-2 flex-wrap">
              <button type="button" disabled={disabled} onClick={() => void openPack(false)} className="font-bold text-white rounded-lg" style={btn}>Open the pack to print</button>
              <button type="button" disabled={disabled} onClick={() => void openPack(true)} className="rounded-lg" style={ghost}>Download as a file (JSON)</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function Box({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border p-4" style={{ borderColor: "var(--dpdp-line)", background: "#fff" }} aria-labelledby={id} data-section={id}>
      <h4 id={id} style={h3}>{title}</h4>
      {children}
    </section>
  )
}

function Evidence({ ov, disabled, forItem, clearItem, onAdd, onWithdraw, onNothing }: {
  ov: ProveOverview; disabled: boolean; forItem: { id: string; name: string } | null; clearItem: () => void
  onAdd: (i: { kind: EvidenceKind; title: string; reference?: string; filename?: string; sha256?: string; sizeBytes?: number; evidenceOn?: string; itemId?: string }) => void
  onWithdraw: (id: string, why: string) => void; onNothing: () => void
}) {
  const [kind, setKind] = useState<EvidenceKind>("policy")
  const [title, setTitle] = useState("")
  const [reference, setReference] = useState("")
  const [on, setOn] = useState("")
  const [file, setFile] = useState<{ name: string; size: number; sha: string } | null>(null)
  const [hashing, setHashing] = useState(false)
  const [why, setWhy] = useState<{ id: string; text: string } | null>(null)
  const isAgreement = forItem !== null
  const k = isAgreement ? "agreement" : kind
  const bad = [title, reference].some((x) => x.trim() !== "" && looksLikePerson(x))
  const ready = title.trim().length >= 2 && !bad && (file !== null || reference.trim() !== "")
  async function pick(f: File | undefined) {
    if (!f) { setFile(null); return }
    setHashing(true)
    try { setFile({ name: f.name, size: f.size, sha: await sha256Hex(await f.arrayBuffer()) }) } finally { setHashing(false) }
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready) return
    onAdd({ kind: k as EvidenceKind, title: title.trim(), ...(reference.trim() ? { reference: reference.trim() } : {}), ...(file ? { filename: file.name, sha256: file.sha, sizeBytes: file.size } : {}), ...(on ? { evidenceOn: on } : {}), ...(forItem ? { itemId: forItem.id } : {}) })
    setTitle(""); setReference(""); setOn(""); setFile(null)
  }
  return (
    <Box id="icp-evidence-h" title={`Records you hold${ov.counts.evidenceThisWeek ? ` · ${ov.counts.evidenceThisWeek} this week` : ""}`}>
      <p style={hint}>{EVIDENCE_NOTE}</p>
      <form id="icp-evidence-form" onSubmit={submit} aria-label="Record a document" className="grid gap-2" style={{ fontSize: 13 }}>
        {isAgreement
          ? <p style={{ margin: 0 }}>Signed agreement with <b>{forItem.name}</b>. <button type="button" className="rounded-lg" style={ghost} onClick={clearItem}>Cancel</button></p>
          : <label>What is it?<br /><select style={field} value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind)} aria-label="Kind of record">{(Object.keys(EVIDENCE_LABEL) as EvidenceKind[]).map((x) => <option key={x} value={x}>{EVIDENCE_LABEL[x]}</option>)}</select></label>}
        <label>Title<br /><input style={{ ...field, width: "100%" }} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Privacy notice, v2" aria-label="Title of the record" /></label>
        <label>The file (optional; it stays on your device)<br /><input type="file" onChange={(e) => void pick(e.target.files?.[0])} aria-label="Choose the file" /></label>
        {hashing && <span>Working out the fingerprint…</span>}
        {file && <span data-testid="icp-fingerprint">Fingerprint: <code>{shortHash(file.sha)}</code> ({file.name})</span>}
        <label>Where the original is kept<br /><input style={{ ...field, width: "100%" }} value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Admin office, cabinet 3" aria-label="Where the original is kept" /></label>
        <label>Date of the record (optional)<br /><input type="date" style={field} value={on} onChange={(e) => setOn(e.target.value)} aria-label="Date of the record" /></label>
        {bad && <span role="alert" style={{ color: "#8a1c1c" }}>That looks like a person&apos;s e-mail or phone number. Describe the record without it.</span>}
        <div className="flex gap-2 flex-wrap"><button type="submit" disabled={disabled || !ready} className="font-bold text-white rounded-lg" style={btn}>Record it</button>
          <button type="button" disabled={disabled} className="rounded-lg" style={ghost} onClick={onNothing}>Nothing to attach this week</button></div>
      </form>
      <ul aria-label="Records you hold" style={{ listStyle: "none", padding: 0, margin: "10px 0 0", fontSize: 13.5 }}>
        {ov.evidence.length === 0 && <li style={{ color: "var(--dpdp-ink2)" }}>Nothing recorded yet.</li>}
        {ov.evidence.map((e) => (
          <li key={e.id} data-evidence={e.title} style={{ margin: "0 0 8px", opacity: e.withdrawn ? 0.6 : 1 }}>
            <b>{e.title}</b> · {EVIDENCE_LABEL[e.kind]} · {niceDate(e.evidenceOn)}{e.itemName ? ` · ${e.itemName}` : ""}
            <div style={{ color: "var(--dpdp-ink2)" }}>{e.sha256 ? <>Fingerprint <code>{shortHash(e.sha256)}</code></> : "No file fingerprint"}{e.reference ? ` · kept at ${e.reference}` : ""}{e.withdrawn ? ` · Withdrawn: ${e.withdrawnReason ?? ""}` : ""}</div>
            {!e.withdrawn && (why?.id === e.id
              ? <span className="flex gap-2 flex-wrap mt-1"><input style={field} aria-label="Why withdraw it" value={why.text} maxLength={200} onChange={(ev) => setWhy({ id: e.id, text: ev.target.value })} placeholder="A few words why" />
                  <button type="button" className="rounded-lg" style={ghost} disabled={disabled || why.text.trim().length < 3 || looksLikePerson(why.text)} onClick={() => { onWithdraw(e.id, why.text.trim()); setWhy(null) }}>Withdraw</button>
                  <button type="button" className="rounded-lg" style={ghost} onClick={() => setWhy(null)}>Keep it</button></span>
              : <button type="button" className="rounded-lg" style={{ ...ghost, marginTop: 4 }} disabled={disabled} onClick={() => setWhy({ id: e.id, text: "" })}>Withdraw this record</button>)}
          </li>
        ))}
      </ul>
    </Box>
  )
}

function Helpers({ ov, disabled, onAttach }: { ov: ProveOverview; disabled: boolean; onAttach: (v: { id: string; name: string }) => void }) {
  return (
    <Box id="icp-helpers-h" title="Outside helpers and their agreements">
      <p style={hint}>Anyone who handles your data for you needs a written agreement (s.8(2)). Attach the signed copy&apos;s fingerprint here so the record is behind the word &quot;signed&quot;.</p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13.5 }}>
        {ov.vendors.length === 0 && <li style={{ color: "var(--dpdp-ink2)" }}>No outside helper on your register. Add one in the register above.</li>}
        {ov.vendors.map((v) => (
          <li key={v.id} data-vendor={v.name} style={{ margin: "0 0 8px" }}>
            <b>{v.name}</b> · {v.agreementStatus === "signed" ? "Signed" : v.agreementStatus === "requested" ? "Asked for" : "No agreement yet"}
            {v.agreementOn ? ` · ${niceDate(v.agreementOn)}` : ""}{v.agreementStatus === "signed" && !v.hasEvidence ? <span style={late}> · no record attached</span> : v.hasEvidence ? " · record attached" : ""}
            <div><button type="button" className="rounded-lg" style={{ ...ghost, marginTop: 4 }} disabled={disabled} onClick={() => onAttach({ id: v.id, name: v.name })}>Attach the signed agreement</button></div>
          </li>
        ))}
      </ul>
    </Box>
  )
}

function Breaches({ ov, disabled, onLog, onStep }: { ov: ProveOverview; disabled: boolean; onLog: (i: { description: string; becameAwareAt?: string; peopleAffected?: number }) => void; onStep: (id: string, u: Parameters<typeof updateBreach>[3], msg: string) => void }) {
  const [desc, setDesc] = useState("")
  const [aware, setAware] = useState("")
  const [people, setPeople] = useState("")
  const bad = desc.trim() !== "" && looksLikePerson(desc)
  const open = ov.breaches.filter((b) => b.state === "open")
  return (
    <Box id="icp-breach-h" title={`Breaches${ov.counts.breachesOpen ? ` · ${ov.counts.breachesOpen} open` : ""}`}>
      <p style={hint}>If personal data is lost, leaked or opened by the wrong person: tell the Board without delay, send the detailed report within 72 hours, and tell each person affected (Rule 7). This keeps the clock and your steps. Describe what happened, not who.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (!bad && desc.trim().length >= 5) { onLog({ description: desc.trim(), ...(aware ? { becameAwareAt: `${aware}T00:00:00Z` } : {}), ...(people !== "" ? { peopleAffected: Number(people) } : {}) }); setDesc(""); setAware(""); setPeople("") } }} aria-label="Record a breach" className="grid gap-2" style={{ fontSize: 13 }}>
        <label>What happened?<br /><textarea style={{ ...field, width: "100%" }} rows={2} value={desc} maxLength={2000} onChange={(e) => setDesc(e.target.value)} aria-label="What happened" /></label>
        <label>The day you came to know (optional, today if empty)<br /><input type="date" style={field} value={aware} onChange={(e) => setAware(e.target.value)} aria-label="Day you came to know" /></label>
        <label>About how many people (optional)<br /><input type="number" min={0} style={field} value={people} onChange={(e) => setPeople(e.target.value)} aria-label="How many people" /></label>
        {bad && <span role="alert" style={{ color: "#8a1c1c" }}>Describe it without any person&apos;s e-mail or phone number.</span>}
        <div><button type="submit" disabled={disabled || bad || desc.trim().length < 5} className="font-bold text-white rounded-lg" style={btn}>Record the breach</button></div>
      </form>
      <ul aria-label="Breaches" style={{ listStyle: "none", padding: 0, margin: "10px 0 0", fontSize: 13.5 }}>
        {ov.breaches.length === 0 && <li style={{ color: "var(--dpdp-ink2)" }}>No breach recorded.</li>}
        {ov.breaches.map((b) => <BreachRow key={b.id} b={b} disabled={disabled} onStep={onStep} open={open.includes(b)} />)}
      </ul>
    </Box>
  )
}
function BreachRow({ b, disabled, onStep, open }: { b: BreachWire; disabled: boolean; onStep: (id: string, u: Parameters<typeof updateBreach>[3], msg: string) => void; open: boolean }) {
  const done = (at: string | null) => (at ? `done ${niceDate(at)}` : "not yet")
  return (
    <li data-breach={b.id} style={{ margin: "0 0 10px", paddingBottom: 8, borderBottom: "1px solid var(--dpdp-line)" }}>
      <b>Came to know {niceDate(b.becameAwareAt)}</b>{b.peopleAffected !== null ? ` · about ${b.peopleAffected} people` : ""} · {b.state === "open" ? "Open" : "Closed"}
      {b.pastClock && <span style={late}> · the 72-hour report to the Board is late</span>}
      <div style={{ color: "var(--dpdp-ink2)" }}>Board told: {done(b.boardNotifiedAt)} · Detailed report (due {niceDate(b.boardDetailDueAt)}): {done(b.boardDetailedAt)} · People told: {done(b.individualsNotifiedAt)} · CERT-In (due {niceDate(b.certInDueAt)}): {done(b.certInReportedAt)}</div>
      {open && (
        <div className="flex gap-2 flex-wrap mt-1">
          {!b.boardNotifiedAt && <button type="button" className="rounded-lg" style={ghost} disabled={disabled} onClick={() => onStep(b.id, { boardNotified: true }, "Recorded: the Board was told.")}>The Board was told</button>}
          {!b.boardDetailedAt && <button type="button" className="rounded-lg" style={ghost} disabled={disabled} onClick={() => onStep(b.id, { boardDetailed: true }, "Recorded: the detailed report was sent.")}>The detailed report was sent</button>}
          {!b.individualsNotifiedAt && <button type="button" className="rounded-lg" style={ghost} disabled={disabled} onClick={() => onStep(b.id, { individualsNotified: true }, "Recorded: the people affected were told.")}>The people affected were told</button>}
          {!b.certInReportedAt && <button type="button" className="rounded-lg" style={ghost} disabled={disabled} onClick={() => onStep(b.id, { certInReported: true }, "Recorded: CERT-In was told.")}>CERT-In was told</button>}
          <button type="button" className="rounded-lg" style={ghost} disabled={disabled} onClick={() => onStep(b.id, { closed: true }, "Closed.")}>Close this record</button>
        </div>
      )}
    </li>
  )
}

function Requests({ ov, disabled, onLog, onClose }: { ov: ProveOverview; disabled: boolean; onLog: (i: { type: RequestType; arrivedVia: ArrivedVia; receivedOn?: string; summary?: string }) => void; onClose: (ref: string, o: RequestOutcome) => void }) {
  const [type, setType] = useState<RequestType>("access")
  const [via, setVia] = useState<ArrivedVia>("in_person")
  const [on, setOn] = useState("")
  const [summary, setSummary] = useState("")
  const bad = summary.trim() !== "" && looksLikePerson(summary)
  const needSummary = type === "grievance"
  return (
    <Box id="icp-requests-h" title={`Requests and grievances${ov.counts.requestsOpen ? ` · ${ov.counts.requestsOpen} open` : ""}`}>
      <p style={hint}>A person can ask to see, correct or erase their data, name someone to act for them, or complain. Reply within the time set (90 days at most). Log only the kind of request and the date: never the person&apos;s name or what they asked.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (!bad && (!needSummary || summary.trim().length >= 3)) { onLog({ type, arrivedVia: via, ...(on ? { receivedOn: on } : {}), ...(needSummary ? { summary: summary.trim() } : {}) }); setSummary(""); setOn("") } }} aria-label="Log a request" className="grid gap-2" style={{ fontSize: 13 }}>
        <label>What is it?<br /><select style={field} value={type} onChange={(e) => setType(e.target.value as RequestType)} aria-label="Kind of request">{(Object.keys(REQUEST_LABEL) as RequestType[]).map((x) => <option key={x} value={x}>{REQUEST_LABEL[x]}</option>)}</select></label>
        <label>How did it arrive?<br /><select style={field} value={via} onChange={(e) => setVia(e.target.value as ArrivedVia)} aria-label="How it arrived">{(Object.keys(VIA_LABEL) as ArrivedVia[]).map((x) => <option key={x} value={x}>{VIA_LABEL[x]}</option>)}</select></label>
        <label>The day it arrived (optional, today if empty)<br /><input type="date" style={field} value={on} onChange={(e) => setOn(e.target.value)} aria-label="Day it arrived" /></label>
        {needSummary && <label>What is it about? (a few words, no names)<br /><input style={{ ...field, width: "100%" }} value={summary} maxLength={300} onChange={(e) => setSummary(e.target.value)} aria-label="What the grievance is about" /></label>}
        {bad && <span role="alert" style={{ color: "#8a1c1c" }}>Leave out the person&apos;s e-mail and phone number.</span>}
        <div><button type="submit" disabled={disabled || bad || (needSummary && summary.trim().length < 3)} className="font-bold text-white rounded-lg" style={btn}>Log it</button></div>
      </form>
      <ul aria-label="Requests and grievances" style={{ listStyle: "none", padding: 0, margin: "10px 0 0", fontSize: 13.5 }}>
        {ov.requests.length === 0 && <li style={{ color: "var(--dpdp-ink2)" }}>Nothing logged.</li>}
        {ov.requests.map((r) => (
          <li key={r.ref} data-request={r.ref} style={{ margin: "0 0 8px" }}>
            <b>{r.ref}</b> · {REQUEST_LABEL[r.type]} · received {niceDate(r.receivedOn)} · reply by {niceDate(r.dueOn)}
            {r.state === "answered" ? ` · answered${r.outcome ? `: ${OUTCOME_LABEL[r.outcome as RequestOutcome] ?? r.outcome}` : ""}` : r.pastDue ? <span style={late}> · past its date</span> : " · open"}
            {r.state === "open" && <ReplyPicker disabled={disabled} onPick={(o) => onClose(r.ref, o)} />}
          </li>
        ))}
      </ul>
    </Box>
  )
}
function ReplyPicker({ disabled, onPick }: { disabled: boolean; onPick: (o: RequestOutcome) => void }) {
  const [o, setO] = useState<RequestOutcome | "">("")
  return (
    <span className="flex gap-2 flex-wrap mt-1">
      <select style={field} value={o} onChange={(e) => setO(e.target.value as RequestOutcome | "")} aria-label="How it was answered"><option value="">How was it answered?</option>{(Object.keys(OUTCOME_LABEL) as RequestOutcome[]).map((x) => <option key={x} value={x}>{OUTCOME_LABEL[x]}</option>)}</select>
      <button type="button" className="rounded-lg" style={ghost} disabled={disabled || !o} onClick={() => o && onPick(o)}>Mark answered</button>
    </span>
  )
}

function Erasure({ ov, disabled, onLog, onClose }: { ov: ProveOverview; disabled: boolean; onLog: (i: { scope: string; trigger: ErasureTrigger; dueOn?: string }) => void; onClose: (id: string, i: { state: "done" | "not_needed"; method?: string }) => void }) {
  const [scope, setScope] = useState("")
  const [trigger, setTrigger] = useState<ErasureTrigger>("retention_ended")
  const [due, setDue] = useState("")
  const [method, setMethod] = useState<Record<string, string>>({})
  const bad = scope.trim() !== "" && looksLikePerson(scope)
  return (
    <Box id="icp-erasure-h" title={`Erasure${ov.counts.erasuresOpen ? ` · ${ov.counts.erasuresOpen} open` : ""}`}>
      <p style={hint}>When data is no longer needed, erase it, and keep a note of what, why, by when, and how. Name the data set, never a person.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (!bad && scope.trim().length >= 2) { onLog({ scope: scope.trim(), trigger, ...(due ? { dueOn: due } : {}) }); setScope(""); setDue("") } }} aria-label="Log an erasure" className="grid gap-2" style={{ fontSize: 13 }}>
        <label>What is to be erased?<br /><input style={{ ...field, width: "100%" }} value={scope} maxLength={160} onChange={(e) => setScope(e.target.value)} placeholder="e.g. Admission forms of 2019" aria-label="What is to be erased" /></label>
        <label>Why?<br /><select style={field} value={trigger} onChange={(e) => setTrigger(e.target.value as ErasureTrigger)} aria-label="Why erase it">{(Object.keys(TRIGGER_LABEL) as ErasureTrigger[]).map((x) => <option key={x} value={x}>{TRIGGER_LABEL[x]}</option>)}</select></label>
        <label>By when (optional, 30 days if empty)<br /><input type="date" style={field} value={due} onChange={(e) => setDue(e.target.value)} aria-label="Erase by" /></label>
        {bad && <span role="alert" style={{ color: "#8a1c1c" }}>Name the data set, not a person.</span>}
        <div><button type="submit" disabled={disabled || bad || scope.trim().length < 2} className="font-bold text-white rounded-lg" style={btn}>Add to the list</button></div>
      </form>
      <ul aria-label="Erasures" style={{ listStyle: "none", padding: 0, margin: "10px 0 0", fontSize: 13.5 }}>
        {ov.erasures.length === 0 && <li style={{ color: "var(--dpdp-ink2)" }}>Nothing on the list.</li>}
        {ov.erasures.map((e) => (
          <li key={e.id} data-erasure={e.scope} style={{ margin: "0 0 8px" }}>
            <b>{e.scope}</b> · {TRIGGER_LABEL[e.trigger]} · by {niceDate(e.dueOn)}
            {e.state === "open" ? (e.pastDue ? <span style={late}> · past its date</span> : " · open") : e.state === "done" ? ` · done ${niceDate(e.doneOn)}${e.method ? ` (${e.method})` : ""}` : ` · not needed${e.method ? ` (${e.method})` : ""}`}
            {e.state === "open" && (
              <span className="flex gap-2 flex-wrap mt-1">
                <input style={field} aria-label={`How ${e.scope} was erased, or why it is not needed`} maxLength={160} value={method[e.id] ?? ""} onChange={(ev) => setMethod({ ...method, [e.id]: ev.target.value })} placeholder="How, or why not needed" />
                <button type="button" className="rounded-lg" style={ghost} disabled={disabled || looksLikePerson(method[e.id] ?? "")} onClick={() => onClose(e.id, { state: "done", ...(method[e.id]?.trim() ? { method: method[e.id].trim() } : {}) })}>Mark done</button>
                <button type="button" className="rounded-lg" style={ghost} disabled={disabled || !(method[e.id] ?? "").trim() || looksLikePerson(method[e.id] ?? "")} onClick={() => onClose(e.id, { state: "not_needed", method: method[e.id].trim() })}>Not needed</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Box>
  )
}
