/// <reference types="bun-types" />
// Owner, 2026-10-05: one consistent header and footer on every e-mail the DPDP product sends. This renders each e-mail builder and fails if its
// output lacks the brand header (wordmark) or the footer (name + support address); the legal links ride in the footer of every mail that may carry
// them (the statutory notices and the alert stay link-free on purpose).
//
// Run: bun test --isolate src/lib/services/dpdp-mail-brand.test.ts
import { describe, expect, test } from 'bun:test'
import { MAIL_BRAND_NAME, MAIL_LEGAL, MAIL_SUPPORT, brandFooterHtml, brandFooterText, brandHeaderHtml, brandWrap } from '../../../supabase/functions/_shared/brand-mail'
import { REMINDER_KINDS, renderReceipt, renderReminder } from '../../../supabase/functions/_shared/billing-mail'
import { renderNotice, type NoticeKind } from '../../../supabase/functions/dpdp-partner-email/render'
import { renderDigest, renderLeakClock, renderRightsClock, type Digest, type RenderLinks } from '../../../supabase/functions/dpdp-monday-email/render'
import { alertEmail } from '../../../supabase/functions/dpdp-ai-link/unfamiliar'

type Mail = { subject: string; html: string; text: string }
const withBrand = (label: string, m: Mail, links = true) => {
  expect(m.html, `${label}: header`).toContain('data-brand="header"')
  expect(m.html, `${label}: footer`).toContain('data-brand="footer"')
  expect(m.html, `${label}: footer name and support`).toContain(`${MAIL_BRAND_NAME} &middot; ${MAIL_SUPPORT}`)
  expect(m.text.startsWith(MAIL_BRAND_NAME), `${label}: text header`).toBe(true)
  expect(m.text, `${label}: text footer`).toContain(`-- ${MAIL_BRAND_NAME}`)
  expect(m.text, `${label}: text support`).toContain(MAIL_SUPPORT)
  for (const l of MAIL_LEGAL) {
    if (links) { expect(m.html, `${label}: ${l.label} link`).toContain(l.url); expect(m.text, `${label}: ${l.label} text`).toContain(l.url) }
    else expect(m.html + m.text, `${label}: no legal link`).not.toContain(l.url)
  }
  expect(m.text.split(`-- ${MAIL_BRAND_NAME}`).length - 1, `${label}: the signature appears once`).toBe(1)
}

describe('the shared header and footer', () => {
  test('header and footer pieces, and wrapping is idempotent', () => {
    expect(brandHeaderHtml()).toContain('VERIDIAN')
    expect(brandFooterHtml()).toContain(MAIL_SUPPORT)
    expect(brandFooterText({ links: false }).join('\n')).not.toContain('http')
    const once = brandWrap({ subject: 's', text: 'body', html: '<p>body</p>' })
    expect(brandWrap(once)).toEqual(once)
  })
})

describe('every e-mail builder carries it', () => {
  test('billing: the receipt and every reminder', () => {
    withBrand('receipt', renderReceipt({ orgName: 'Acme', plan: 'firm', interval: 'year', amountPaise: 1180000, periodStart: '2026-10-01', confirmedAt: '2026-10-02', razorpayPaymentId: null }))
    for (const kind of REMINDER_KINDS) withBrand(`reminder ${kind}`, renderReminder({ kind, orgName: 'Acme', daysLeft: 3, dueDate: '2026-10-10', priceLabel: 'Rs 11,800', appUrl: 'https://dpdp.veridian-aios.com/app/' }))
  })
  test('partner: every notice kind', () => {
    const kinds: NoticeKind[] = ['welcome', 'referred_signup', 'commission_earned', 'payout_sent', 'statement', 'details_changed']
    for (const kind of kinds) withBrand(`partner ${kind}`, renderNotice({ id: 'n1', kind, to: 'p@example.test', name: 'Asha', payload: { period: '2026-09', amountPaise: 5000, netPaise: 4500, tdsPaise: 500, grossPaise: 5000 } }))
  })
  test('the unfamiliar-use alert (no link of any kind)', () => {
    withBrand('alert', alertEmail({ alert: true, to: 'a@b.test', org: 'Acme', role: 'owner', label: null, newNetwork: true, newTool: false, at: '' }), false)
  })
  const digest: Digest = {
    membershipId: 'm1', identityId: 'i1', orgId: 'o1', orgName: 'Acme', orgProduct: 'firm', email: 'p@example.test', level: 'staff', roleKind: 'staff', weekKey: '2026-W40', today: '2026-09-28',
    unsubscribed: false, statutoryOnly: false, alreadySentThisWeek: false, owners: [], coordinators: [], jobs: [], escalatedToMe: [],
  }
  const links: RenderLinks = { signIn: 'https://example.invalid/s', actions: null, unsubscribeUrl: 'https://example.invalid/u', appHome: 'https://dpdp.veridian-aios.com/app/', aiLink: null }
  test('the Monday digest, the statutory view, and the two legal-clock notices (their own bar, same name, same support address)', () => {
    const own = (label: string, m: Mail) => {
      expect(m.text.startsWith(MAIL_BRAND_NAME), `${label}: text header`).toBe(true)
      expect(m.html, `${label}: wordmark`).toContain('VERIDIAN AI')
      expect(m.html + m.text, `${label}: support address`).toContain(MAIL_SUPPORT)
      expect(m.html + m.text, `${label}: no stray tagline`).not.toContain('One Portal. One Truth.')
    }
    own('digest', renderDigest(digest, links))
    own('statutory', renderDigest({ ...digest, statutoryOnly: true }, links, 'statutory'))
    const r = { membershipId: 'm1', identityId: 'i1', email: 'a@b.test', role: 'owner' as const }
    own('leak', renderLeakClock({ breachId: 'b', orgId: 'o', orgName: 'Acme', becameAwareAt: '2026-10-01T00:00:00Z', deadlineAt: '2026-10-04T00:00:00Z', hoursLeft: 5, boardNotified: false, individualsNotified: false, scopePersonCount: null, periodKey: 'k', recipients: [r] }, r, links))
    own('rights', renderRightsClock({ requestId: 'q', ref: 'R1', kind: 'access', orgId: 'o', orgName: 'Acme', receivedAt: '2026-07-01T00:00:00Z', dueAt: '2026-09-29T00:00:00Z', daysLeft: 2, periodKey: 'k', recipients: [r] }, r, links))
  })
})
