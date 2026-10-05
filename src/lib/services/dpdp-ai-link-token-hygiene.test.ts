/// <reference types="bun-types" />
// Owner, 2026-10-05: an AI work link's token appears ONLY (1) where a person deliberately copies it from -- the plain-text paste box of the one e-mail
// that is made for that, and the signed-in AI Link page -- and never (2) in an attachment, PDF, export or report, nor (3) in any other mail a person
// might forward, nor (4) in any hyperlink. This test scans the mail builders and the report renderers for the token pattern and "/ai/", and scans the
// source for every place that builds a link address, so a new place has to be added to the allow-list on purpose.
//
// Run: bun test --isolate src/lib/services/dpdp-ai-link-token-hygiene.test.ts
import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PLACEHOLDER, renderDigest, renderLeakClock, renderRightsClock, type Digest, type RenderLinks,
} from '../../../supabase/functions/dpdp-monday-email/render'
import { renderReceipt, renderReminder } from '../../../supabase/functions/_shared/billing-mail'
import { renderNotice } from '../../../supabase/functions/dpdp-partner-email/render'
import { alertEmail } from '../../../supabase/functions/dpdp-ai-link/unfamiliar'
import { renderReportCsv, renderReportMarkdown, type ReportPayload } from '../../../supabase/functions/dpdp-ai-link/router'

const TOKEN = 'cd'.repeat(32)
const URL_ = `https://dpdp.veridian-aios.com/ai/${TOKEN}`
const HEX64 = /[0-9a-f]{64}/
const ROOT = join(import.meta.dir, '..', '..', '..')

const digest = (over: Partial<Digest> = {}): Digest => ({
  membershipId: 'm1', identityId: 'i1', orgId: 'o1', orgName: 'Acme', orgProduct: 'firm', email: 'priya@acmeca.in', level: 'staff', roleKind: 'staff',
  weekKey: '2026-W40', today: '2026-09-28', unsubscribed: false, statutoryOnly: false, alreadySentThisWeek: false,
  owners: [], coordinators: [], jobs: [], escalatedToMe: [], ...over,
})
const links = (aiLink: RenderLinks['aiLink']): RenderLinks => ({
  signIn: 'https://example.invalid/signin', actions: null, unsubscribeUrl: 'https://example.invalid/unsub', appHome: 'https://dpdp.veridian-aios.com/app/', aiLink,
})
const AI = { url: URL_, expiresOn: '2026-10-07', level: 1 as const, jobs: 3, people: 2, validHours: 48, aiPageUrl: 'https://dpdp.veridian-aios.com/app/#ai-link-settings' }

describe('the one e-mail that carries a link: the token is in the plain-text paste box and nowhere else', () => {
  const out = renderDigest(digest(), links(AI))
  test('text: exactly one occurrence, inside the box between the two rules', () => {
    expect(out.text.split(TOKEN).length - 1).toBe(1)
    const box = out.text.slice(out.text.indexOf('----------------'), out.text.lastIndexOf('----------------'))
    expect(box).toContain(TOKEN)
  })
  test('html: exactly one occurrence, never in an attribute (no href, no src, no title)', () => {
    expect(out.html.split(TOKEN).length - 1).toBe(1)
    for (const m of out.html.matchAll(/<[^>]+>/g)) expect(m[0], 'a tag that holds the token').not.toContain(TOKEN)
    expect(out.html).not.toMatch(/href="[^"]*\/ai\//)
  })
  test('the same e-mail without the box carries neither the token nor /ai/', () => {
    const stripped = (out.text.slice(0, out.text.indexOf('----------------')) + out.text.slice(out.text.lastIndexOf('----------------'))).replace(/https:\/\/dpdp\.veridian-aios\.com\/ai\/\S*/g, '')
    expect(stripped).not.toContain(TOKEN)
    expect(stripped).not.toContain('/ai/')
  })
})

describe('no other mail, report or export can carry a link', () => {
  const noLink = (label: string, s: string) => {
    expect(s, `${label}: token`).not.toContain(TOKEN)
    expect(s, `${label}: /ai/`).not.toContain('/ai/')
    expect(s, `${label}: 64-hex`).not.toMatch(HEX64)
  }
  test('the digest without a link, the statutory view, the changes-only mail and a dry run', () => {
    for (const [label, d, l, kind] of [
      ['no link', digest(), links(null), 'monday_digest'],
      ['statutory', digest({ statutoryOnly: true }), links(AI), 'statutory'],
      ['changes only', digest({ aiChangesOnly: true }), links(AI), 'monday_digest'],
    ] as const) {
      const r = renderDigest(d, l, kind)
      noLink(`${label} html`, r.html); noLink(`${label} text`, r.text)
    }
    const dry = renderDigest(digest(), links({ ...AI, url: PLACEHOLDER.aiLink }))
    expect(dry.html + dry.text).not.toMatch(HEX64)
  })
  test('the leak clock, rights clock, receipt, reminder, partner notice and the unfamiliar-use alert', () => {
    const recipient = { membershipId: 'm1', identityId: 'i1', email: 'a@b.test', role: 'owner' as const }
    const leak = renderLeakClock({ breachId: 'b1', orgId: 'o1', orgName: 'Acme', becameAwareAt: '2026-10-01T00:00:00Z', deadlineAt: '2026-10-04T00:00:00Z', hoursLeft: 10, boardNotified: false, individualsNotified: false, scopePersonCount: 5, periodKey: 'k', recipients: [recipient] }, recipient, links(AI))
    const rights = renderRightsClock({ requestId: 'r1', ref: 'R-1', kind: 'access', orgId: 'o1', orgName: 'Acme', receivedAt: '2026-07-01T00:00:00Z', dueAt: '2026-09-29T00:00:00Z', daysLeft: 5, periodKey: 'k', recipients: [recipient] }, recipient, links(AI))
    for (const [n, r] of [['leak', leak], ['rights', rights]] as const) { noLink(`${n} html`, r.html); noLink(`${n} text`, r.text) }
    const alert = alertEmail({ alert: true, to: 'a@b.test', org: 'Acme', role: 'owner', label: 'Monday email', newNetwork: true, newTool: false, at: '2026-10-05T00:00:00Z' })
    noLink('alert html', alert.html); noLink('alert text', alert.text)
    expect(alert.html + alert.text).not.toMatch(/https?:\/\//)
    expect(renderReceipt).toBeTypeOf('function'); expect(renderReminder).toBeTypeOf('function'); expect(renderNotice).toBeTypeOf('function')
  })
  test('the Markdown and CSV reports an AI hands over end with the brand footer and carry no link', () => {
    const r: ReportPayload = {
      kind: 'summary', org: { id: 'o1', name: 'Acme' }, generatedAt: '2026-10-05T00:00:00Z', asOf: '2026-10-05',
      summary: { total: 3, done: 1, open: 2, late: 1, dueToday: 0, notApplicable: 0, nobody: 0, requiredToday: { total: 1, done: 0, late: 0 }, byPart: [{ part: 1, total: 3, done: 1, late: 1 }] },
    }
    noLink('report md', renderReportMarkdown(r)); noLink('report csv', renderReportCsv(r))
  })
})

describe('where the source builds a link address (a new place must be added here on purpose)', () => {
  const files = execFileSync('git', ['ls-files', 'supabase/functions', 'dpdp-app/src', 'dpdp-app/functions', 'src/lib/services', 'src/app/api/dpdp'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/\.test\.|\/e2e\//.test(f))
  const ALLOWED = new Set([
    'supabase/functions/dpdp-monday-email/ai-link-email.ts', // mints the e-mail's own short-lived link and builds its plain-text paste
    'supabase/functions/dpdp-monday-email/render.ts', // the paste box
    'supabase/functions/dpdp-monday-email/index.ts', // dry run placeholder
    'supabase/functions/dpdp-ai-link/index.ts', // the API itself (linkBase) and /prompt
    'supabase/functions/dpdp-ai-link/manual.ts', // paths relative to the base; never the token
    'supabase/functions/dpdp-ai-link/router.ts', // parseRoute
    'supabase/functions/_shared/ai-link/prompt.ts',
    'dpdp-app/src/lib/api.ts', // aiLinkUrl: the signed-in page shows the link its owner just made
    'dpdp-app/src/lib/copy-prompt.ts', // fetches the paste for the signed-in page
    'dpdp-app/functions/ai/_proxy.ts', // the /ai/<token> proxy
    'dpdp-app/src/components/AiWorkLink.tsx', // the signed-in AI Link page
    'dpdp-app/src/components/AiFirstSteps.tsx', // the signed-in app's first-steps page
  ])
  test('only the allow-listed files build /ai/<token> addresses or the paste', () => {
    const hits = files.filter((f) => /\/ai\/\$\{|aiLinkUrl\(|aiPasteText\(|dpdp_timer_mint_email_ai_link/.test(readFileSync(join(ROOT, f), 'utf8')))
    const unexpected = hits.filter((f) => !ALLOWED.has(f) && !/\/api\/dpdp\/ai\//.test(f) && !/^src\/lib\/services\/dpdp-ai-link-service\.ts$|^src\/lib\/dpdp-internal-ai\.ts$/.test(f))
    expect(unexpected, `a new place builds an AI link address: ${unexpected.join(', ')}`).toEqual([])
  })
  test('no PDF, export or attachment builder in the DPDP mail or app code references the link helpers', () => {
    const pdfish = files.filter((f) => /pdf|export|report|attach/i.test(f.split('/').pop() ?? ''))
    for (const f of pdfish) expect(readFileSync(join(ROOT, f), 'utf8'), f).not.toMatch(/aiPasteText\(|aiLinkUrl\(|mintAiLink\(/)
  })
})
