import "./onepage/dpdp-onepage-tokens.css"
import { useCallback, useEffect, useState } from "react"
import { applyIcpRules, confirmIcpItems, fetchIcpRegister, fetchIcpStatus, retireIcpItem, saveIcpItem, signOffIcpStage, startIcpRegister } from "@/lib/api"
import type { DpdpClient } from "@/lib/client"
import {
  AGREEMENT_LABEL, BASIS_LABEL, KIND_LABEL, KIND_LABEL_PLURAL, PRINCIPAL_LABEL, SENSITIVITY_LABEL, STAGES, STAGE_INFO, STATUS_WORD,
  looksLikePerson, retentionLine, weekLine,
  type AgreementStatus, type IcpItem, type IcpItemInput, type IcpKind, type IcpSection, type IcpStage, type IcpStatus, type LawfulBasis, type PrincipalType, type Sensitivity,
} from "@/lib/icp"

// The weekly ICP routine, at the top of the signed-in page: IDENTIFY what you hold, CLASSIFY it, PROVE it, every week. The checklist and the register
// are read from the database (drizzle/0761); nothing on this screen is worked out on the device except what to show. The score counts this week's
// routine steps. It is not a rating of the organisation's legal position, and the screen says so.
const card = { background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" } as const
const btn = { background: "var(--dpdp-v)", fontSize: 14, padding: "8px 14px" } as const
const ghost = { fontSize: 13.5, padding: "6px 12px", border: "1px solid var(--dpdp-line)", background: "#fff", color: "var(--dpdp-ink)" } as const
const field = { fontSize: 14, padding: "6px 8px", border: "1px solid var(--dpdp-line)", borderRadius: 8, background: "#fff", color: "var(--dpdp-ink)", maxWidth: "100%" } as const
const RETENTION: { label: string; days: number }[] = [{ label: "1 year", days: 365 }, { label: "3 years", days: 1095 }, { label: "7 years", days: 2555 }, { label: "10 years", days: 3650 }]

export function IcpWeek({ client, orgId, offline, canEdit, onChanged }: { client: DpdpClient; orgId: string; offline: boolean; canEdit: boolean; onChanged: () => void | Promise<void> }) {
  const [status, setStatus] = useState<IcpStatus | null>(null)
  const [items, setItems] = useState<IcpItem[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([fetchIcpStatus(client, orgId), fetchIcpRegister(client, orgId)])
      setStatus(s); setItems(r); setProblem(null)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "We could not read your weekly routine just now. Try again in a moment.")
    }
  }, [client, orgId])
  useEffect(() => { void load() }, [load])

  async function run(what: () => Promise<string | void>) {
    setBusy(true); setProblem(null); setNote(null)
    try { const msg = await what(); if (msg) setNote(msg); await load(); await onChanged() } catch (e) { setProblem(e instanceof Error ? e.message : "That did not work. Nothing was changed.") } finally { setBusy(false) }
  }

  return (
    <div className="dpdp-onepage" id="icp-week" data-testid="icp-week">
      <div className="max-w-[1240px] mx-auto px-5 pt-4">
        <section className="rounded-[22px] border p-6" style={card} aria-labelledby="icp-h">
          <h2 id="icp-h" style={{ fontFamily: "Sora, sans-serif", fontSize: 22, fontWeight: 700, margin: "0 0 4px", color: "var(--dpdp-ink)" }}>This week: Identify, Classify, Prove</h2>
          <p style={{ fontSize: 14, color: "var(--dpdp-ink2)", margin: "0 0 12px", maxWidth: "76ch" }}>
            Three short steps, once a week. Know what you hold, sort it, and keep the records that show it. Your Monday e-mail brings you here.
          </p>
          {status && (
            <p data-testid="icp-score" style={{ fontSize: 15, margin: "0 0 14px", color: "var(--dpdp-ink)" }}>
              Week of <b>{weekLine(status.weekStart)}</b>: <b>{status.done}</b> of <b>{status.total}</b> steps done ({status.percent}%) · {STATUS_WORD[status.status]}.{" "}
              <span style={{ color: "var(--dpdp-ink3)", fontSize: 13 }}>This counts this week&apos;s routine steps. It is not a rating of your legal position.</span>
            </p>
          )}
          {problem && <p role="alert" style={{ fontSize: 14, color: "#8a1c1c", margin: "0 0 10px" }}>{problem}</p>}
          {note && <p role="status" style={{ fontSize: 14, color: "var(--dpdp-g, #0B5F26)", margin: "0 0 10px" }}>{note}</p>}
          {offline && <p style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", margin: "0 0 10px" }}>You are offline. The routine needs a connection to save; what you see is what was last read.</p>}

          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {STAGES.map((id, n) => (
              <StageCard key={id} id={id} index={n + 1} section={status ? status[id] : null} canEdit={canEdit} busy={busy}
                onSignOff={() => run(async () => { await signOffIcpStage(client, orgId, id); return `${STAGE_INFO[id].name} signed off for this week.` })}
                onRules={() => run(async () => { const n2 = await applyIcpRules(client, orgId); return n2 ? `${n2} children's-data job(s) switched back on.` : "Nothing needed switching." })}
              />
            ))}
          </div>

          <Register
            items={items} canEdit={canEdit} busy={busy} editing={editing} setEditing={setEditing}
            onStart={() => run(async () => { const n = await startIcpRegister(client, orgId); return n ? `${n} data set(s) added from the library. Now classify them.` : "Nothing new to add from the library." })}
            onConfirmAll={() => run(async () => { const n = await confirmIcpItems(client, orgId); return `${n} line(s) confirmed as still true this week.` })}
            onNothingNew={() => run(async () => { await signOffIcpStage(client, orgId, "identify", "Nothing new this week"); return "Recorded: nothing new this week." })}
            onAdd={(input) => run(async () => { await saveIcpItem(client, orgId, input); return "Added to your register." })}
            onSave={(input) => run(async () => { await saveIcpItem(client, orgId, input); setEditing(null); return "Saved." })}
            onRetire={(id, reason) => run(async () => { await retireIcpItem(client, orgId, id, reason); return "Taken off your register." })}
          />
        </section>
      </div>
    </div>
  )
}

function StageCard({ id, index, section, canEdit, busy, onSignOff, onRules }: { id: IcpStage; index: number; section: IcpSection | null; canEdit: boolean; busy: boolean; onSignOff: () => void; onRules: () => void }) {
  const info = STAGE_INFO[id]
  return (
    <article className="rounded-2xl border p-4" style={{ borderColor: "var(--dpdp-line)", background: "#fff" }} aria-labelledby={`icp-stage-${id}`} data-stage={id}>
      <h3 id={`icp-stage-${id}`} style={{ fontFamily: "Sora, sans-serif", fontSize: 18, fontWeight: 700, margin: 0, color: "var(--dpdp-ink)" }}>{index}. {info.name}{section ? ` · ${section.done} of ${section.total}` : ""}</h3>
      <p style={{ fontSize: 13.5, color: "var(--dpdp-ink2)", margin: "4px 0 10px" }}>{info.promise}</p>
      {!section ? <p style={{ fontSize: 13 }}>Loading…</p> : (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
          {section.steps.map((s) => (
            <li key={s.key} data-step={s.key} data-done={s.done} style={{ fontSize: 13.5, margin: "0 0 6px", color: "var(--dpdp-ink)" }}>
              <span aria-hidden="true">{s.done ? "✓" : "○"}</span> <span className="sr-only">{s.done ? "Done: " : "Still to do: "}</span>{s.label}
              {!s.done && s.count ? <b> ({s.count})</b> : null}
              {!s.done && s.action === "rules" && canEdit && <> <button type="button" disabled={busy} onClick={onRules} className="rounded-lg" style={ghost}>Switch them on</button></>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && <button type="button" disabled={busy || !section} onClick={onSignOff} className="font-bold text-white rounded-lg" style={btn}>Sign off {info.name}</button>}
    </article>
  )
}

function Register(p: {
  items: IcpItem[]; canEdit: boolean; busy: boolean; editing: string | null; setEditing: (id: string | null) => void
  onStart: () => void; onConfirmAll: () => void; onNothingNew: () => void; onAdd: (i: IcpItemInput) => void; onSave: (i: IcpItemInput) => void; onRetire: (id: string, reason: string) => void
}) {
  const [kind, setKind] = useState<IcpKind>("data_set")
  const [name, setName] = useState("")
  const [where, setWhere] = useState("")
  const bad = name.trim() !== "" && looksLikePerson(name)
  const kinds = (["data_set", "system", "vendor", "person_group"] as IcpKind[]).filter((k) => p.items.some((i) => i.kind === k))
  return (
    <div className="mt-6" id="icp-register" data-testid="icp-register">
      <h3 style={{ fontFamily: "Sora, sans-serif", fontSize: 18, fontWeight: 700, margin: "0 0 4px", color: "var(--dpdp-ink)" }}>Your register: what you hold</h3>
      <p style={{ fontSize: 13.5, color: "var(--dpdp-ink2)", margin: "0 0 10px", maxWidth: "76ch" }}>
        Write the name of the kind of data, the system or the outside helper. Never type a person&apos;s name, e-mail address or phone number here.
      </p>
      {p.canEdit && (
        <div className="flex gap-2 flex-wrap mb-4">
          <button type="button" disabled={p.busy} onClick={p.onStart} className="rounded-lg" style={ghost}>Start from the library</button>
          <button type="button" disabled={p.busy || p.items.length === 0} onClick={p.onConfirmAll} className="rounded-lg" style={ghost}>Everything here is still true</button>
          <button type="button" disabled={p.busy} onClick={p.onNothingNew} className="rounded-lg" style={ghost}>Nothing new this week</button>
        </div>
      )}
      {p.items.length === 0 && <p style={{ fontSize: 14, color: "var(--dpdp-ink2)" }}>Nothing is on your register yet. Start from the library, or add your first line below.</p>}
      {kinds.map((k) => (
        <div key={k} className="mb-4">
          <h4 style={{ fontSize: 14.5, fontWeight: 700, margin: "0 0 6px", color: "var(--dpdp-ink)" }}>{KIND_LABEL_PLURAL[k]}</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {p.items.filter((i) => i.kind === k).map((i) => (
              <li key={i.id} className="rounded-xl border p-3 mb-2" style={{ borderColor: "var(--dpdp-line)", background: "#fff" }} data-item={i.name}>
                <div style={{ fontSize: 14.5, color: "var(--dpdp-ink)" }}><b>{i.name}</b>{i.whereHeld ? <> · kept in {i.whereHeld}</> : null}</div>
                <div style={{ fontSize: 13, color: "var(--dpdp-ink2)" }}>
                  {i.principalType ? PRINCIPAL_LABEL[i.principalType] : "Whose data: not set"}
                  {i.children === true ? " · children" : i.children === false ? " · adults" : ""}
                  {i.lawfulBasis ? ` · ${BASIS_LABEL[i.lawfulBasis]}` : ""}
                  {i.kind === "vendor" ? ` · ${AGREEMENT_LABEL[i.agreementStatus ?? "none"]}` : ` · kept ${retentionLine(i)}`}
                </div>
                {i.flags.length > 0 && (
                  <ul aria-label={`Things to look at for ${i.name}`} style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13, color: "#8a4b00" }}>
                    {i.flags.map((f) => <li key={f.key}>{f.text}</li>)}
                  </ul>
                )}
                {p.canEdit && (
                  <div className="flex gap-2 mt-2">
                    <button type="button" className="rounded-lg" style={ghost} onClick={() => p.setEditing(p.editing === i.id ? null : i.id)} aria-expanded={p.editing === i.id}>{p.editing === i.id ? "Close" : "Classify or change"}</button>
                    <button type="button" className="rounded-lg" style={ghost} disabled={p.busy} onClick={() => { const r = window.prompt(`Why is "${i.name}" no longer held? (a few words)`); if (r && r.trim()) p.onRetire(i.id, r.trim()) }}>No longer held</button>
                  </div>
                )}
                {p.editing === i.id && p.canEdit && <Editor item={i} busy={p.busy} onSave={p.onSave} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {p.canEdit && (
        <form className="flex gap-2 flex-wrap items-end" onSubmit={(e) => { e.preventDefault(); if (!bad && name.trim()) { p.onAdd({ kind, name: name.trim(), ...(where.trim() ? { whereHeld: where.trim() } : {}) }); setName(""); setWhere("") } }} aria-label="Add a line to your register">
          <label style={{ fontSize: 13 }}>What is it?<br />
            <select value={kind} onChange={(e) => setKind(e.target.value as IcpKind)} style={field} aria-label="What kind of line">{(Object.keys(KIND_LABEL) as IcpKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
          <label style={{ fontSize: 13 }}>Name<br /><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Student admission files" style={{ ...field, width: 240 }} aria-label="Name of the line" /></label>
          <label style={{ fontSize: 13 }}>Where it is kept (optional)<br /><input value={where} onChange={(e) => setWhere(e.target.value)} maxLength={160} placeholder="e.g. School ERP" style={{ ...field, width: 220 }} aria-label="Where it is kept" /></label>
          <button type="submit" disabled={p.busy || bad || !name.trim()} className="font-bold text-white rounded-lg" style={btn}>Add to register</button>
          {bad && <span role="alert" style={{ fontSize: 13, color: "#8a1c1c" }}>That looks like a person&apos;s contact. Name the kind of data or the system instead.</span>}
        </form>
      )}
    </div>
  )
}

function Editor({ item, busy, onSave }: { item: IcpItem; busy: boolean; onSave: (i: IcpItemInput) => void }) {
  const [principalType, setPrincipal] = useState<PrincipalType | "">(item.principalType ?? "")
  const [children, setChildren] = useState<"" | "yes" | "no">(item.children === null ? "" : item.children ? "yes" : "no")
  const [purpose, setPurpose] = useState(item.purpose ?? "")
  const [basis, setBasis] = useState<LawfulBasis | "">(item.lawfulBasis ?? "")
  const [tier, setTier] = useState<Sensitivity | "">(item.sensitivity ?? "")
  const [days, setDays] = useState<string>(item.retentionDays ? String(item.retentionDays) : "")
  const [rnote, setRnote] = useState(item.retentionNote ?? "")
  const [recipients, setRecipients] = useState(item.recipients ?? "")
  const [agree, setAgree] = useState<AgreementStatus | "">(item.agreementStatus ?? "")
  const [aref, setAref] = useState(item.agreementRef ?? "")
  const [whereHeld, setWhere] = useState(item.whereHeld ?? "")
  const personal = item.kind === "data_set" || item.kind === "person_group"
  const save = () => onSave({
    id: item.id, whereHeld: whereHeld || null,
    ...(personal ? {
      principalType: (principalType || null) as PrincipalType | null, children: children === "" ? null : children === "yes", purpose: purpose || null,
      lawfulBasis: (basis || null) as LawfulBasis | null, sensitivity: (tier || null) as Sensitivity | null,
      retentionDays: days ? Number(days) : null, retentionNote: days ? null : rnote || null, recipients: recipients || null,
    } : {}),
    ...(item.kind === "vendor" ? { agreementStatus: (agree || null) as AgreementStatus | null, agreementRef: aref || null } : {}),
  })
  return (
    <div role="group" aria-label={`Classify ${item.name}`} className="grid gap-3 mt-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", fontSize: 13 }}>
      <label>Where it is kept<br /><input style={field} value={whereHeld} maxLength={160} onChange={(e) => setWhere(e.target.value)} /></label>
      {personal && <>
        <label>Whose data is it?<br /><select style={field} value={principalType} onChange={(e) => setPrincipal(e.target.value as PrincipalType | "")}><option value="">Choose…</option>{(Object.keys(PRINCIPAL_LABEL) as PrincipalType[]).map((k) => <option key={k} value={k}>{PRINCIPAL_LABEL[k]}</option>)}</select></label>
        <label>Is it children&apos;s data (under 18)?<br /><select style={field} value={children} onChange={(e) => setChildren(e.target.value as "" | "yes" | "no")}><option value="">Choose…</option><option value="yes">Yes, children</option><option value="no">No, adults only</option></select></label>
        <label>Why do you hold it?<br /><input style={field} value={purpose} maxLength={200} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Admission and teaching" /></label>
        <label>On what basis?<br /><select style={field} value={basis} onChange={(e) => setBasis(e.target.value as LawfulBasis | "")}><option value="">Choose…</option>{(Object.keys(BASIS_LABEL) as LawfulBasis[]).map((k) => <option key={k} value={k}>{BASIS_LABEL[k]}</option>)}</select></label>
        <label>How much care does it need?<br /><select style={field} value={tier} onChange={(e) => setTier(e.target.value as Sensitivity | "")}><option value="">Choose…</option>{(Object.keys(SENSITIVITY_LABEL) as Sensitivity[]).map((k) => <option key={k} value={k}>{SENSITIVITY_LABEL[k]}</option>)}</select></label>
        <label>How long do you keep it?<br /><select style={field} value={days} onChange={(e) => setDays(e.target.value)}><option value="">Another period (write it)</option>{RETENTION.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}</select></label>
        {!days && <label>Keep until…<br /><input style={field} value={rnote} maxLength={160} onChange={(e) => setRnote(e.target.value)} placeholder="e.g. Until the student leaves, then 3 years" /></label>}
        <label>Who else receives it?<br /><input style={field} value={recipients} maxLength={200} onChange={(e) => setRecipients(e.target.value)} placeholder="e.g. Board, bank" /></label>
      </>}
      {item.kind === "vendor" && <>
        <label>Agreement<br /><select style={field} value={agree} onChange={(e) => setAgree(e.target.value as AgreementStatus | "")}><option value="">Choose…</option>{(Object.keys(AGREEMENT_LABEL) as AgreementStatus[]).map((k) => <option key={k} value={k}>{AGREEMENT_LABEL[k]}</option>)}</select></label>
        <label>Agreement reference<br /><input style={field} value={aref} maxLength={120} onChange={(e) => setAref(e.target.value)} placeholder="e.g. Letter dated 1 Nov" /></label>
      </>}
      <div><button type="button" disabled={busy} onClick={save} className="font-bold text-white rounded-lg" style={btn}>Save</button></div>
    </div>
  )
}
