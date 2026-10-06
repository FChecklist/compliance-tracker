/// <reference types="bun-types" />
// THE LOCK POLICY, as a guard. History: drizzle/0655 set an Owner rule, "a compliance tool must not lock a client out of their own statutory
// obligations over an unpaid invoice" (this file was dpdp-access-never-locks.test.ts, use case UC-F07). On 2026-10-06 the Owner reversed it in chat:
// an account unpaid past TRIAL (30 days) -> DUE -> GRACE (7 days) is LOCKED, with a short list of things that must stay open because a law or a
// person is waiting (pay, download my data, record a breach, answer a grievance, honour a consent withdrawal). drizzle/0734 implements that.
//
// The rule is now a property of the WHOLE code base again, so it is guarded as a source scan, in the same shape as before:
//   * the lock exists in exactly ONE place (dpdp.assert_not_locked) with exactly THREE callers, and no other migration refuses anything because of
//     a trial date or a subscription state;
//   * the always-open allow-list in the migration equals the list the screen shows (billing-state.ts LOCKED_ALLOWED_RPCS);
//   * the app reads the billing state only in the components that explain or collect payment;
//   * the Monday e-mail only SHOWS the state, it never skips the statutory digest because of it.
// The behaviour itself (every boundary, the real gate) is proven on a real Postgres in dpdp-account-billing.pglite.test.ts.
import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { LOCKED_ALLOWED_RPCS } from '../../../dpdp-app/src/lib/billing-state'

const ROOT = join(import.meta.dir, '..', '..', '..')
const sqlFiles = readdirSync(join(ROOT, 'drizzle')).filter((f) => /^\d{4}_.*\.sql$/.test(f))
const sql = (f: string) => readFileSync(join(ROOT, 'drizzle', f), 'utf8')
const LOCK_FILE = '0734_dpdp_account_opening_plans_billing.sql'

/** Migrations allowed to mention the trial end date in an expression, and why. */
const TRIAL_DATE_READERS: Record<string, string> = {
  '0415_dpdp_phase1_schema.sql': 'creates the column',
  '0655_dpdp_wo016_refer_and_earn.sql': 'writes it at sign-up (30 days) and reports it in dpdp_my_billing (a display value)',
  '0658_dpdp_payment_confirmation_flow.sql': 'payment confirmation flow: writes the row, reports it',
  '0661_dpdp_my_billing_proof_fields.sql': 'dpdp_my_billing report only',
  '0673_dpdp_razorpay_sales_lifecycle.sql': 'the reminder worklist: SELECTS who to e-mail, changes nothing about access',
  '0674_dpdp_sales_partner_lifecycle.sql': 'sign-up paths: writes the 30-day trial; partner stats count orgs in trial',
  '0676_dpdp_claim_reject_and_ai_link_billing_notice.sql': 'dpdp_ai_link_billing_notice only READS the trial end to return a flag the AI link prints as a notice',
  '0694_dpdp_ai_link_register.sql': 'dpdp_ai_link_register(plan) only READS the plan band and trial end for a read-only register',
  '0720_dpdp_ai_link_hide_emails_default.sql': 'copy of the 0694 dpdp_ai_link_register body; it still only READS the plan band and trial end',
}

/** The "I have paid" claim flow refuses an approve/reject when the org is not awaiting confirmation: the state machine of a payment CLAIM, not a gate on using the product. */
const CLAIM_FLOW_FILES = new Set(['0655_dpdp_wo016_refer_and_earn.sql', '0658_dpdp_payment_confirmation_flow.sql', '0676_dpdp_claim_reject_and_ai_link_billing_notice.sql'])

function functionBodies(text: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = []
  const re = /create or replace function ((?:public|dpdp)\.\w+)\([\s\S]*?\$\$;/g
  for (const m of text.matchAll(re)) out.push({ name: m[1], body: m[0] })
  return out
}

describe('the lock policy (drizzle/0734 reverses the 0655 never-lock rule, Owner, 2026-10-06)', () => {
  test('no migration has a policy that reads the subscription, the account or a trial date, and none refuses on a trial/subscription state outside the claim flow', () => {
    for (const f of sqlFiles) {
      const text = sql(f)
      expect(text, `${f}: a policy that reads dpdp.subscription`).not.toMatch(/create policy[^;]*dpdp\.subscription/i)
      expect(text, `${f}: a policy that reads dpdp.account`).not.toMatch(/create policy[^;]*dpdp\.account\b/i)
      expect(text, `${f}: a policy mentioning trial_ends_at`).not.toMatch(/create policy[^;]*trial_ends_at/i)
      if (CLAIM_FLOW_FILES.has(f)) continue
      for (const m of text.matchAll(/if\b[^;]{0,200}(trial_ends_at|subscription\.state|v_sub\.state|sub\.state)[^;]{0,200}\bthen\s+raise exception/gi))
        throw new Error(`${f}: refuses something based on the trial/subscription state: ${m[0].slice(0, 160)}`)
    }
  })

  test('only the known files read trial_ends_at (a new reader must be reviewed against the lock policy and added here)', () => {
    const readers = sqlFiles.filter((f) => /trial_ends_at/.test(sql(f)) && !/^0(0|1|2|3|4)\d\d_/.test(f) || f.startsWith('0415'))
    const unknown = readers.filter((f) => !(f in TRIAL_DATE_READERS))
    expect(unknown, `new migration(s) reading trial_ends_at: ${unknown.join(', ')}`).toEqual([])
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
    expect(body).toMatch(/language plpgsql stable/)
    expect(body).not.toMatch(/\b(insert into|update dpdp|delete from)\b/i)
  })

  test('the lock lives in ONE function with exactly three callers: the working-screen door, the AI work link door and the firm client cap', () => {
    const callers = new Set<string>()
    for (const f of sqlFiles) {
      const text = sql(f)
      if (f !== LOCK_FILE) {
        expect(text, `${f}: calls the lock outside ${LOCK_FILE}`).not.toContain('assert_not_locked')
        expect(text, `${f}: raises the payment-due refusal outside ${LOCK_FILE}`).not.toContain('Payment is due for this account')
      }
    }
    for (const fn of functionBodies(sql(LOCK_FILE))) {
      if (fn.name !== 'dpdp.assert_not_locked' && fn.body.includes('assert_not_locked(')) callers.add(fn.name)
    }
    expect([...callers].sort()).toEqual(['public.dpdp__ai_link_for_token', 'public.dpdp__caller_membership', 'public.dpdp_create_client_org'])
  })

  test('the gate lets the always-open actions through: exactly the functions on the screen list use the open door or set the allow flag', () => {
    const open = new Set<string>()
    for (const fn of functionBodies(sql(LOCK_FILE))) {
      if (fn.name === 'public.dpdp__caller_membership' || fn.name === 'public.dpdp__caller_membership_open') continue
      if (/dpdp__caller_membership_open\(/.test(fn.body) || /set_config\('dpdp\.allow_locked', 'on', true\)/.test(fn.body)) open.add(fn.name.replace(/^public\./, ''))
    }
    // the account reads and writes the OWNER makes while paying, choosing a plan or giving firm details also use the open door
    const alsoOpen = ['dpdp_account_choose_plan', 'dpdp_account_set_professional']
    const expected = [...LOCKED_ALLOWED_RPCS.filter((n) => n !== 'dpdp_consent_withdraw'), ...alsoOpen].sort()
    expect([...open].sort()).toEqual(expected)
  })

  test('a consent withdrawal never meets the gate (token based, no membership door)', () => {
    const f = sqlFiles.filter((x) => /create or replace function public\.dpdp_consent_withdraw\(/i.test(sql(x))).pop()!
    const text = sql(f)
    const body = text.slice(text.search(/create or replace function public\.dpdp_consent_withdraw\(/i))
    const end = body.indexOf('\n$$;')
    expect(body.slice(0, end)).not.toContain('dpdp__caller_membership')
    expect(body.slice(0, end)).not.toContain('dpdp__ai_link_for_token')
  })

  test('in the app the billing state is read only where payment is explained or collected', () => {
    const allowed = new Set(['BillingPanel.tsx', 'OwnerPaymentAdmin.tsx', 'PaymentDue.tsx', 'OwnerAccountsAdmin.tsx'])
    const dir = join(ROOT, 'dpdp-app', 'src', 'components')
    for (const f of readdirSync(dir).filter((x) => /\.tsx$/.test(x) && !allowed.has(x))) {
      const t = readFileSync(join(dir, f), 'utf8')
      expect(t, `${f} reads the billing state`).not.toMatch(/billing\.state|subscriptionState|trialEndsAt|"LOCKED"|"GRACE"/)
    }
  })

  test('BillingPanel explains, it does not gate: no early return or throw keyed to the state, and it no longer promises a trial can never stop anything', () => {
    const t = readFileSync(join(ROOT, 'dpdp-app', 'src', 'components', 'BillingPanel.tsx'), 'utf8')
    expect(t).not.toContain('Access to the product never depends')
    expect(t).not.toContain('Nothing stops working when the trial ends')
    expect(t).not.toMatch(/billing\.state\s*(===|!==)\s*"(trial|awaiting_confirmation|active)"\s*\)\s*(return null|throw)/)
  })

  test('the Monday e-mail only SHOWS the state (a banner and the due line), it does not skip or withhold the statutory digest because of it', () => {
    const t = readFileSync(join(ROOT, 'supabase', 'functions', 'dpdp-monday-email', 'render.ts'), 'utf8')
    const lines = t.split('\n').filter((l) => /subscriptionState|billingDueLine/.test(l))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l, 'a skip/return keyed to the billing state').not.toMatch(/return\s+null|continue\b|skip/i)
  })
})
