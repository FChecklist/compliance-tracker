// A small in-memory stand-in for the audit RPCs (drizzle/0730) for the Edge Function handler tests. It computes the chain with the SAME functions the verifier uses, so the
// handler is exercised against real hashes; the SQL side itself is proven separately on real Postgres (dpdp-audit-trail.pglite.test.ts, which also pins TS == SQL).
import { GENESIS, contentHashOf, rowHashOf } from '../../../../supabase/functions/_shared/audit/chain'

export type Row = { seq: number; id: string; org_id: string; event_type: string; actor_user_id: string | null; server_time_us: number; content_canonical: string; content_hash: string; prev_hash: string; row_hash: string; ref_hash: string | null }
type Err = { code?: string; message: string }
export type Person = { identityId: string; email: string; memberships: Array<{ orgId: string; orgName: string; level: string; hod: boolean }>; isPlatformOwner?: boolean }

export class FakeAuditDb {
  rows: Row[] = []
  calls: string[] = []
  heads: Array<{ head_date: string; head_hash: string; last_seq: number; row_count: number; org: string }> = []
  failAppend = false
  anchor: Record<string, { hash: string; seq: number }> = {}
  accessLog: Array<{ id: string; email: string; org: string; reason: string; rows: number | null }> = []
  hold: Record<string, boolean> = {}
  private seq = 0
  private clock = 1_790_000_000_000_000
  people: Person[]
  constructor(people: Person[]) { this.people = people }

  rpc = async (fn: string, a: Record<string, unknown>): Promise<{ data: unknown; error: Err | null }> => {
    this.calls.push(fn)
    const ok = (data: unknown) => ({ data, error: null })
    switch (fn) {
      case 'dpdp_audit_resolve_caller': {
        const p = this.people.find((x) => x.email.toLowerCase() === String(a.p_email).toLowerCase())
        return ok(p ? { identityId: p.identityId, memberships: p.memberships, isPlatformOwner: !!p.isPlatformOwner } : { identityId: null, memberships: [], isPlatformOwner: false })
      }
      case 'dpdp_audit_append': {
        if (this.failAppend) return { data: null, error: { code: 'XX000', message: 'boom' } }
        const content = String(a.p_content)
        let j: { org_id?: string; event_type?: string; actor?: { user_id?: string | null } }
        try { j = JSON.parse(content) } catch { return { data: null, error: { code: '22023', message: 'not valid JSON' } } }
        const org = j.org_id!
        const last = [...this.rows].reverse().find((r) => r.org_id === org)
        const prev = last?.row_hash ?? this.anchor[org]?.hash ?? GENESIS
        const us = this.clock += 1000
        const ch = await contentHashOf(content)
        const id = `id${++this.seq}`
        const rh = await rowHashOf(prev, ch, id, org, us)
        const row: Row = { seq: this.seq, id, org_id: org, event_type: j.event_type!, actor_user_id: j.actor?.user_id ?? null, server_time_us: us, content_canonical: content, content_hash: ch, prev_hash: prev, row_hash: rh, ref_hash: (a.p_ref_hash as string) ?? null }
        this.rows.push(row)
        return ok({ id, seq: row.seq, rowHash: rh, orgId: org })
      }
      case 'dpdp_audit_fetch': {
        const after = Number(a.p_after_seq ?? 0)
        const out = this.rows.filter((r) => r.org_id === a.p_org && r.seq > after && (a.p_actor == null || r.actor_user_id === a.p_actor)).slice(0, Number(a.p_limit ?? 1000))
        return ok(out.map(({ ref_hash: _r, ...rest }) => rest))
      }
      case 'dpdp_audit_chain_state': {
        const org = String(a.p_org); const mine = this.rows.filter((r) => r.org_id === org)
        return ok({ anchor: this.anchor[org]?.hash ?? GENESIS, anchorSeq: this.anchor[org]?.seq ?? 0, head: mine.at(-1)?.row_hash ?? null, lastSeq: mine.at(-1)?.seq ?? null, rows: mine.length, legalHold: !!this.hold[org] })
      }
      case 'dpdp_audit_count_exports':
        return ok(this.rows.filter((r) => r.org_id === a.p_org && r.actor_user_id === a.p_actor && r.event_type === 'download_export').length)
      case 'dpdp_audit_count_recent':
        return ok(this.rows.filter((r) => r.org_id === a.p_org && r.actor_user_id === a.p_actor && r.event_type === a.p_type).length)
      case 'dpdp_audit_find_export': {
        const r = this.rows.find((x) => x.event_type === 'download_export' && x.ref_hash === a.p_hash)
        return ok(r ? { found: true, orgId: r.org_id, issuedAt: '2026-10-06T00:00:00Z', rowHash: r.row_hash, actorUserId: r.actor_user_id } : { found: false })
      }
      case 'dpdp_audit_recorded_heads':
        return ok(this.heads.filter((h) => h.org === a.p_org).map(({ org: _o, ...h }) => h))
      case 'dpdp_audit_set_hod': {
        const p = this.people.find((x) => x.email === a.p_email)
        const m = p?.memberships.find((x) => x.orgId === a.p_org && x.level === 'owner')
        if (!m) return { data: null, error: { code: '42501', message: 'Only an owner of this organisation may name who can download its whole audit log' } }
        for (const q of this.people) for (const mm of q.memberships) if (mm.orgId === a.p_org) mm.hod = (a.p_identity_ids as string[]).includes(q.identityId)
        return ok({ orgId: a.p_org, hod: a.p_identity_ids })
      }
      case 'dpdp_audit_staff_begin': {
        const p = this.people.find((x) => x.email.toLowerCase() === String(a.p_email).toLowerCase())
        if (!p?.isPlatformOwner) return { data: null, error: { code: '42501', message: 'Only the platform owner may read full audit values' } }
        if (String(a.p_reason ?? '').trim().length < 10) return { data: null, error: { code: '22023', message: 'A reason of at least 10 characters is required to read full audit values' } }
        const id = `log${this.accessLog.length + 1}`
        this.accessLog.push({ id, email: String(a.p_email), org: String(a.p_org), reason: String(a.p_reason), rows: null })
        return ok(id)
      }
      case 'dpdp_audit_staff_finish': {
        const l = this.accessLog.find((x) => x.id === a.p_log_id); if (l && l.rows === null) l.rows = Number(a.p_rows)
        return ok(null)
      }
      case 'dpdp_audit_set_legal_hold': {
        const p = this.people.find((x) => x.email === a.p_email)
        if (!p?.isPlatformOwner) return { data: null, error: { code: '42501', message: 'Only the platform owner may set a legal hold' } }
        this.hold[String(a.p_org)] = a.p_hold === true
        return ok({ orgId: a.p_org, legalHold: a.p_hold })
      }
      default:
        return { data: null, error: { message: `fake: ${fn} not implemented` } }
    }
  }
}
