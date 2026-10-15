/// <reference types="bun-types" />
// DPDP billing emails (supabase/functions/_shared/billing-mail.ts): the "what can go wrong" cases from the
// use-case catalogue (dpdp-app/USE-CASES.md, group E and F) that dpdp-billing-mail.test.ts does not cover:
// hostile and unusual organisation names (HTML, quotes, line breaks, Hindi, emoji, very long), calendar
// edge dates (leap day, year end, no DST in IST/UTC), the singular/plural day text at every boundary, the
// bounce guard for addresses that can never receive mail, and that nothing in the money wording drifts.
import { describe, expect, test } from 'bun:test'
import { REMINDER_KINDS, type ReminderKind, dateLabel, isDeliverableAddress, oneLine, renderReceipt, renderReminder, rupees } from '../../../supabase/functions/_shared/billing-mail'
import { buildOutbound, resendPayload } from '../../../supabase/functions/_shared/mail-outbound'

const base = { daysLeft: 3, dueDate: '2026-10-31T00:00:00Z', priceLabel: rupees(999900), appUrl: 'https://dpdp.veridian-aios.com/app/' }
const HOSTILE = [
  `<script>alert(1)</script>`,
  `"><img src=x onerror=alert(1)>`,
  `Robert'); DROP TABLE dpdp.organisation;--`,
  `A & B <Associates> "quoted"`,
  `कंपनी हिंदी सलाहकार`,
  `Emoji 🚀 Co ✅`,
  `=HYPERLINK("http://evil","x")`,
  'X'.repeat(120),
]

describe('hostile organisation names in the five reminders and the receipt', () => {
  for (const name of HOSTILE)
    for (const kind of REMINDER_KINDS) {
      test(`${kind}: ${name.slice(0, 28)}`, () => {
        const r = renderReminder({ ...base, kind, orgName: name })
        // the HTML body never contains a live tag from the name: every < > " & of it is escaped (span and a are the fixed brand header/footer markup)
        const html = r.html
        expect(html).not.toContain('<script')
        expect(html).not.toContain('<img')
        expect(html.match(/<(?!\/?(div|p|br|span|a)\b)[a-z!]/gi)).toBeNull()
        // the plain-text body keeps the name exactly (it is text, not markup)
        expect(r.text).toContain(name)
        // the subject is one line
        expect(r.subject).not.toMatch(/[\r\n]/)
      })
    }

  test('the receipt escapes the name in HTML and keeps it in the text', () => {
    const r = renderReceipt({ orgName: HOSTILE[0], plan: 'firm', interval: 'year', amountPaise: 999900, periodStart: '2026-10-01', confirmedAt: '2026-10-01T10:00:00Z', razorpayPaymentId: '<b>pay_1</b>' })
    expect(r.html).not.toContain('<script')
    expect(r.html).not.toContain('<b>pay_1</b>')
    expect(r.html).toContain('&lt;b&gt;pay_1&lt;/b&gt;')
    expect(r.text).toContain(HOSTILE[0])
  })

  test('an apostrophe is left alone (it is safe in a text node) but an ampersand is always escaped', () => {
    const r = renderReminder({ ...base, kind: 'trial3', orgName: `Ram & Sons' LLP` })
    expect(r.html).toContain('Ram &amp; Sons')
    expect(r.html).not.toContain('Ram & Sons')
  })
})

describe('line breaks in an organisation name cannot reach the Subject header (header-injection guard)', () => {
  const nasty = ['Acme\r\nBcc: attacker@evil.test', 'Acme\nSubject: spoof', 'Acme\u2028Bcc: x', 'Acme\u0085next', 'Acme\ttab', 'Acme\u0000nul']
  for (const name of nasty)
    test(JSON.stringify(name), () => {
      for (const kind of REMINDER_KINDS) expect(renderReminder({ ...base, kind, orgName: name }).subject).not.toMatch(/[\r\n\u2028\u2029\u0085\u0000\t]/)
      expect(renderReceipt({ orgName: name, plan: 'firm', interval: 'year', amountPaise: 1, periodStart: '2026-10-01', confirmedAt: '2026-10-01' }).subject).not.toMatch(/[\r\n\u2028\u2029\u0085\u0000\t]/)
      // and the finished envelope + Resend body carry it as ONE JSON string field, never as a header line
      const out = buildOutbound('sales_chain', renderReminder({ ...base, kind: 'trial3', orgName: name }).subject)
      expect(out.subject).not.toMatch(/[\r\n]/)
      expect(JSON.stringify(resendPayload('o@x.test', out, { html: '', text: '' }))).not.toMatch(/\\r|\\n.*Bcc/)
    })

  test('oneLine collapses runs, trims, and leaves ordinary text and Hindi alone', () => {
    expect(oneLine('  a \r\n\r\n b  ')).toBe('a b')
    expect(oneLine('कंपनी हिंदी')).toBe('कंपनी हिंदी')
    expect(oneLine('Emoji 🚀')).toBe('Emoji 🚀')
    expect(oneLine('')).toBe('')
  })
})

describe('days-left wording at every boundary the SQL can produce (0, 1, 2, 3, 10 and a stray large value)', () => {
  const sing = (n: number) => `${n} day${n === 1 ? '' : 's'}`
  for (const n of [0, 1, 2, 3, 7, 9, 10, 30]) {
    test(`trial reminder with ${n} days left says "${sing(n)}"`, () => {
      const r = renderReminder({ ...base, kind: 'trial3', orgName: 'Acme', daysLeft: n })
      expect(r.subject).toBe(`Your free trial ends in ${sing(n)} -- Acme`)
    })
  }
  test('the day-30 message (trial ended) and the renewals stay calm: no lock-out vocabulary, and they say the data is safe / it still works for a few days', () => {
    for (const kind of ['trial0', 'renew30', 'renew7'] as ReminderKind[]) {
      const t = renderReminder({ ...base, kind, orgName: 'Acme', daysLeft: 0 }).text.toLowerCase()
      expect(t).not.toMatch(/locked|suspend|disabled|deactivat|terminate|lose access|will be removed|deleted/)
      expect(t).toMatch(/access|safe|late/)
    }
  })
})

describe('dates: fixed format, UTC, leap day, year end, invalid input', () => {
  test('leap day and year end render without drifting a day', () => {
    expect(dateLabel('2028-02-29T00:00:00Z')).toBe('29 Feb 2028')
    expect(dateLabel('2026-12-31T23:59:59Z')).toBe('31 Dec 2026')
    expect(dateLabel('2027-01-01T00:00:00Z')).toBe('1 Jan 2027')
  })
  test('a trial that ends at 23:30 UTC is labelled with its UTC date (the date the reminder key uses), not the IST next day', () => {
    expect(dateLabel('2027-03-31T23:30:00Z')).toBe('31 Mar 2027')
  })
  test('a date-only value is read as UTC midnight, an unparseable one is echoed, not thrown', () => {
    expect(dateLabel('2026-10-31')).toBe('31 Oct 2026')
    expect(dateLabel('')).toBe('')
    expect(dateLabel('31/10/2026 nonsense')).toBe('31/10/2026 nonsense')
  })
  test('rupees: Indian grouping, whole rupees, zero and a large amount', () => {
    expect(rupees(999900)).toBe('Rs 9,999')
    expect(rupees(0)).toBe('Rs 0')
    expect(rupees(12345678900)).toBe('Rs 12,34,56,789')
  })
})

describe('bounce guard: an address that can never receive mail is not mailed (and so cannot bounce)', () => {
  test('reserved and malformed addresses are refused', () => {
    for (const bad of ['', 'plain', '@x.com', 'a@', 'a@b', 'a@localhost', 'a@x.test', 'a@x.invalid', 'a@example.com', 'a@mail.example.org', 'A@EXAMPLE.NET', ' a@x.test '])
      expect(isDeliverableAddress(bad), bad).toBe(false)
  })
  test('ordinary addresses, subdomains and uppercase are accepted', () => {
    for (const ok of ['a@b.co', 'first.last+tag@sub.domain.in', 'A@Firm.COM', ' a@firm.com ', 'x@notexample.com'])
      expect(isDeliverableAddress(ok), ok).toBe(true)
  })
})
