/// <reference types="bun-types" />
// OWNER RULE (drizzle/0655, quoted in BillingPanel.tsx and every reminder): "a compliance tool must not lock a client out of
// their own statutory obligations over an unpaid invoice" -- trial, awaiting_confirmation and active ALL behave the same, and
// "Payment pending" is a label, never a gate. This is the use-case catalogue's guard for that rule (USE-CASES.md UC-F07),
// written as a source scan because the rule is a property of the WHOLE code base, not of one function.
//
// It fails if a new migration or screen starts to READ a trial date or a subscription state to allow or refuse something.
// The allow-lists below are the places that read them today and why each is only a label, a reminder or a ledger:
import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..', '..')
const sqlFiles = readdirSync(join(ROOT, 'drizzle')).filter((f) => /^\d{4}_.*\.sql$/.test(f))
const sql = (f: string) => readFileSync(join(ROOT, 'drizzle', f), 'utf8')

/** Migrations allowed to mention the trial end date in an expression, and why. */
const TRIAL_DATE_READERS: Record<string, string> = {
  '0415_dpdp_phase1_schema.sql': 'creates the column',
  '0655_dpdp_wo016_refer_and_earn.sql': 'writes it at sign-up (30 days) and reports it in dpdp_my_billing (a display value)',
  '0658_dpdp_payment_confirmation_flow.sql': 'payment confirmation flow: writes the row, reports it',
  '0661_dpdp_my_billing_proof_fields.sql': 'dpdp_my_billing report only',
  '0673_dpdp_razorpay_sales_lifecycle.sql': 'the reminder worklist: SELECTS who to e-mail, changes nothing about access',
  '0674_dpdp_sales_partner_lifecycle.sql': 'sign-up paths: writes the 30-day trial; partner stats count orgs in trial',
  '0676_dpdp_claim_reject_and_ai_link_billing_notice.sql': 'dpdp_ai_link_billing_notice only READS the trial end to return a flag the AI link prints as a notice; it raises nothing about it and no route branches on it to refuse',
  '0693_dpdp_ai_link_register.sql': 'dpdp_ai_link_register(plan) only READS the plan band and trial end for a read-only register; nothing is refused or locked by it',
}

/** The "I have paid" claim flow refuses an approve/reject when the org is not awaiting confirmation (0655 declare, 0658 approve/reject, 0676 which supersedes the 0658 approve/reject bodies). That is the state machine of a payment CLAIM, not a gate on using the product. */
const CLAIM_FLOW_FILES = new Set(['0655_dpdp_wo016_refer_and_earn.sql', '0658_dpdp_payment_confirmation_flow.sql', '0676_dpdp_claim_reject_and_ai_link_billing_notice.sql'])

describe('access never locks over an unpaid invoice', () => {
  test('no migration compares the trial end or the subscription state inside a RAISE/RLS gate', () => {
    for (const f of sqlFiles) {
      const text = sql(f)
      // an RLS policy or a guard that reads the subscription is a lock
      expect(text, `${f}: a policy that reads dpdp.subscription`).not.toMatch(/create policy[^;]*dpdp\.subscription/i)
      expect(text, `${f}: a policy mentioning trial_ends_at`).not.toMatch(/create policy[^;]*trial_ends_at/i)
      // a refusal sitting next to a trial/subscription state test
      if (CLAIM_FLOW_FILES.has(f)) continue // see CLAIM_FLOW_FILES
      for (const m of text.matchAll(/if\b[^;]{0,200}(trial_ends_at|subscription\.state|v_sub\.state|sub\.state)[^;]{0,200}\bthen\s+raise exception/gi))
        throw new Error(`${f}: refuses something based on the trial/subscription state: ${m[0].slice(0, 160)}`)
    }
  })

  test('only the known files read trial_ends_at (a new reader must be reviewed against the owner rule and added here)', () => {
    const readers = sqlFiles.filter((f) => /trial_ends_at/.test(sql(f)) && !/^0(0|1|2|3|4)\d\d_/.test(f) || f.startsWith('0415'))
    const unknown = readers.filter((f) => !(f in TRIAL_DATE_READERS))
    expect(unknown, `new migration(s) reading trial_ends_at: ${unknown.join(', ')} -- confirm each is display/reminder only, then list it with its reason`).toEqual([])
  })

  test('the only comparison of trial_ends_at against the clock is the reminder worklist, which only lists', () => {
    const offenders: string[] = []
    for (const f of sqlFiles) {
      const text = sql(f)
      if (/trial_ends_at\s*(<|>|<=|>=)\s*(now\(\)|clock_timestamp\(\)|current_)/i.test(text) || /(now\(\)|clock_timestamp\(\)|current_timestamp)\s*(<|>|<=|>=)\s*[a-z_.]*trial_ends_at/i.test(text)) offenders.push(f)
    }
    expect(offenders).toEqual([])
    const worklist = sql('0673_dpdp_razorpay_sales_lifecycle.sql')
    const body = worklist.slice(worklist.indexOf('function public.dpdp_sales_due_reminders'), worklist.indexOf('function public.dpdp_sales_reminder_claim'))
    expect(body).toMatch(/language plpgsql stable/) // STABLE: it cannot write
    expect(body).not.toMatch(/\b(insert into|update dpdp|delete from)\b/i)
  })

  test('in the app the subscription state only drives wording in BillingPanel; no other screen reads it', () => {
    const allowed = new Set(['BillingPanel.tsx', 'OwnerPaymentAdmin.tsx'])
    const dir = join(ROOT, 'dpdp-app', 'src', 'components')
    for (const f of readdirSync(dir).filter((x) => /\.tsx$/.test(x) && !allowed.has(x))) {
      const t = readFileSync(join(dir, f), 'utf8')
      expect(t, `${f} reads the billing state`).not.toMatch(/billing\.state|subscriptionState|trialEndsAt/)
    }
  })

  test('BillingPanel never disables the working screens: the state feeds only the pill label and the payment box', () => {
    const t = readFileSync(join(ROOT, 'dpdp-app', 'src', 'components', 'BillingPanel.tsx'), 'utf8')
    expect(t).toMatch(/Access to the product never depends/)
    // no state-dependent redirect, throw or early return of the whole app from this component
    expect(t).not.toMatch(/billing\.state\s*(===|!==)\s*"(trial|awaiting_confirmation|active)"\s*\)\s*(return null|throw)/)
  })

  test('the Monday e-mail only SHOWS the state (a banner), it does not skip or withhold the statutory digest because of it', () => {
    const t = readFileSync(join(ROOT, 'supabase', 'functions', 'dpdp-monday-email', 'render.ts'), 'utf8')
    const lines = t.split('\n').filter((l) => /subscriptionState/.test(l))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l, 'a skip/return keyed to the subscription state').not.toMatch(/return\s+null|continue\b|skip/i)
  })
})
