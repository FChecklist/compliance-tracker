/// <reference types="bun-types" />
// The weekly ICP block of the Monday e-mail (supabase/functions/dpdp-monday-email/icp-block.ts, wired into render.ts): the per-stage checklist, the score, the
// carry-over, the snapshot line, the per-client roll-up for a Professional (firm) organisation. Pure TypeScript; no Deno, no database.
// The SQL it is fed by is proven in dpdp-icp-monday-block.pglite.test.ts.
import { describe, expect, test } from 'bun:test'
import { icpBlockUsable, icpHeadline, icpStageLink, renderIcpBlock, type IcpBlock, type IcpClient } from '../../../supabase/functions/dpdp-monday-email/icp-block'
import { isEmpty, renderDigest, statutorySubset, subjectFor, type Digest, type RenderLinks } from '../../../supabase/functions/dpdp-monday-email/render'

const APP = 'https://dpdp.veridian-aios.com/app/'
const links: RenderLinks = { signIn: null, actions: null, unsubscribeUrl: null, appHome: APP }

const step = (key: string, label: string, done: boolean, count: number | null = null) => ({ key, label, done, count })
function block(over: Partial<IcpBlock> = {}): IcpBlock {
  return {
    orgId: 'o1', orgName: 'Sunrise School', product: 'institution', weekStart: '2026-11-09', percent: 29, done: 4, total: 14, status: 'in_progress',
    stages: [
      { stage: 'identify', title: 'Identify: what you hold', done: 2, total: 3, steps: [step('register_started', 'Start your register', true), step('confirm_register', 'Check each line of your register is still true', true), step('anything_new', 'Add anything new this week, or say there is nothing new', false)] },
      { stage: 'classify', title: 'Classify: why, on what basis, for how long', done: 1, total: 4, steps: [step('classify_items', 'Classify every line', false, 3), step('children_rules', "Children's data has a basis", true), step('vendor_rules', 'Outside helpers have agreements', false, 1), step('jobs_follow_register', 'Jobs follow the register', false)] },
      { stage: 'prove', title: 'Prove: the records that show what you did', done: 1, total: 7, steps: [step('jobs_not_late', 'No job is late', true), step('evidence_this_week', 'A record this week', false), step('week_signed_off', 'A person signs off the week', false)] },
    ],
    carriedOver: [{ stage: 'classify', key: 'classify_items', label: 'Classify every line', count: 3 }],
    viewerMembershipIds: ['m1'], snapshotsAdded: 3, clients: [], clientTotal: 0, notALegalRating: true, note: 'x', recorded: true, ...over,
  }
}
function digest(over: Partial<Digest> = {}): Digest {
  return {
    membershipId: 'm1', identityId: 'i1', orgId: 'o1', orgName: 'Sunrise School', orgProduct: 'institution', email: 'owner@example.test', level: 'owner', roleKind: 'owner',
    weekKey: '2026-W46', today: '2026-11-16', unsubscribed: false, statutoryOnly: false, alreadySentThisWeek: false, owners: [], coordinators: [], jobs: [], escalatedToMe: [], ...over,
  }
}
const client = (name: string, percent: number, started = true): IcpClient => ({
  orgId: name, name, started, percent, done: Math.round((14 * percent) / 100), total: 14, identify: { done: 1, total: 3 }, classify: { done: 0, total: 4 }, prove: { done: 2, total: 7 },
})

describe('the block', () => {
  test('lists the three stages with their steps, marks each Done or To do, and counts open steps in the button', () => {
    const r = renderIcpBlock(block(), APP)
    for (const t of ['Identify: what you hold', 'Classify: why, on what basis, for how long', 'Prove: the records that show what you did']) expect(r.html).toContain(t)
    expect(r.html).toContain('Done: Start your register')
    expect(r.html).toContain('To do: Add anything new this week, or say there is nothing new')
    expect(r.html).toContain('Do the 3 steps left in classify')
    expect(r.html).toContain('Do the 1 step left in identify')
    expect(r.text.join('\n')).toContain('[to do] Classify every line (3)')
  })
  test('the headline is a plain count of steps and the sentence says it is not a rating', () => {
    expect(icpHeadline(block())).toBe("4 of 14 steps of this week's routine are done (29%).")
    expect(icpHeadline(block({ done: 0, percent: 0 }))).toBe("Nothing from this week's routine is done yet: 14 steps to go.")
    expect(icpHeadline(block({ done: 14, percent: 100 }))).toBe("All 14 steps of this week's routine are done.")
    const r = renderIcpBlock(block(), APP)
    expect(r.html).toContain('it is not a rating of Sunrise School')
    expect(r.html).toContain('Week of 9 November 2026')
  })
  test('what is still open from last week is its own list, and absent when there is none', () => {
    const r = renderIcpBlock(block(), APP)
    expect(r.html).toContain('Still open from last week (1)')
    expect(renderIcpBlock(block({ carriedOver: [] }), APP).html).not.toContain('Still open from last week')
  })
  test('the snapshot sentence appears only on a real send (a dry run records nothing, so it must not say it did)', () => {
    expect(renderIcpBlock(block({ recorded: true }), APP).html).toContain('added to your weekly record')
    expect(renderIcpBlock(block({ recorded: false }), APP).html).not.toContain('weekly record')
  })
  test('stage links stay on the app page, carry no credential, and drop an earlier hash', () => {
    expect(icpStageLink(`${APP}#something`, 'classify')).toBe(`${APP}#icp-stage-classify`)
    const r = renderIcpBlock(block(), APP)
    expect(r.html).toContain(`${APP}#icp-stage-identify`)
    expect(r.html).not.toMatch(/token|supabase\.co|\?t=/i)
  })
  test('never claims compliance, certification, a guarantee or verification', () => {
    const all = (r: { html: string; text: string[] }) => `${r.html}\n${r.text.join('\n')}`
    const a = all(renderIcpBlock(block(), APP)) + all(renderIcpBlock(block({ product: 'firm', clientTotal: 2, clients: [client('A Ltd', 10), client('B Ltd', 80)] }), APP))
    expect(/compliant|certif|guarantee|verified|proof of compliance/i.test(a)).toBe(false)
  })
  test('hostile text from the database is escaped', () => {
    const r = renderIcpBlock(block({ orgName: '<img src=x onerror=1>', stages: block().stages.map((s) => ({ ...s, title: '<script>x</script>' })) }), APP)
    expect(r.html).not.toContain('<script>')
    expect(r.html).not.toContain('<img src=x')
    expect(r.html).toContain('&lt;script&gt;')
  })
})

describe('the per-client roll-up (Professional / firm only)', () => {
  test('shows each client as counts, in the order given, with a not-started line, and a "more" line past 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => client(`Client ${i + 1}`, i * 4))
    const b = block({ product: 'firm', clientTotal: 25, clients: [client('Zeta Schools', 0, false), ...many.slice(0, 24)] })
    const r = renderIcpBlock(b, APP)
    expect(r.html).toContain('Your clients this week (25)')
    expect(r.html).toContain('Zeta Schools: the routine has not been started (0 of 14 steps)')
    expect(r.html).toContain('Identify 1/3, Classify 0/4, Prove 2/7')
    expect(r.html).toContain('And 5 more: open the page for the full list.')
    expect(r.html).toContain('not a rating of any client')
    expect((r.html.match(/<li>/g) ?? []).length).toBeGreaterThan(20)
  })
  test('an institution never gets a roll-up, and a firm with no client gets none either', () => {
    expect(renderIcpBlock(block({ product: 'institution', clientTotal: 3, clients: [client('X', 1)] }), APP).html).not.toContain('Your clients')
    expect(renderIcpBlock(block({ product: 'firm', clientTotal: 0, clients: [] }), APP).html).not.toContain('Your clients')
  })
})

describe('inside the e-mail', () => {
  test('a whole-organisation member with nothing due still gets the e-mail, with the block and the score in the subject', () => {
    const d = digest({ icp: block() })
    expect(isEmpty(d)).toBe(false)
    expect(isEmpty(digest())).toBe(true)
    expect(subjectFor(d)).toContain('routine 4 of 14')
    const r = renderDigest(d, links)
    expect(r.html).toContain('routine: Identify, Classify, Prove')
    expect(r.text).toContain("THIS WEEK'S ROUTINE: IDENTIFY, CLASSIFY, PROVE")
    expect(r.html.indexOf('routine: Identify, Classify, Prove')).toBeGreaterThan(-1)
  })
  test('the statutory-only view (someone who stopped the weekly e-mail) never carries the block, and an AI-changes-only e-mail does not either', () => {
    const d = digest({ icp: block(), jobs: [] })
    expect(statutorySubset(d).icp).toBeNull()
    expect(isEmpty(statutorySubset(d))).toBe(true)
    expect(renderDigest(statutorySubset(d), links, 'statutory').html).not.toContain('routine: Identify, Classify, Prove')
    expect(renderDigest({ ...d, aiChangesOnly: true }, links).html).not.toContain('routine: Identify, Classify, Prove')
  })
  test('a staff digest (no block attached) is unchanged, and a malformed block is dropped rather than half-rendered', () => {
    const plain = renderDigest(digest({ level: 'staff', roleKind: 'staff' }), links)
    expect(plain.html).not.toContain('routine: Identify, Classify, Prove')
    const broken = { ...block(), stages: [] } as IcpBlock
    expect(icpBlockUsable(broken)).toBe(false)
    expect(isEmpty(digest({ icp: broken }))).toBe(true)
    expect(renderDigest(digest({ icp: broken, jobs: [] }), links).html).not.toContain('routine: Identify, Classify, Prove')
  })
  test('the block comes before the controls list so the weekly routine leads the e-mail', () => {
    const d = digest({ icp: block(), jobs: [{ obligationId: 'j1', key: 'firm-04', what: 'Write down where it is kept', part: 2, dueOn: '2026-11-01', daysLate: 0, late: false, requiredToday: false, isGroup: false, groupLabel: null, assigneeEmail: 'a@example.test', isMine: true, stuck: false, outsideParty: false }] })
    const html = renderDigest(d, links).html
    expect(html.indexOf('routine: Identify, Classify, Prove')).toBeLessThan(html.indexOf('Your controls'))
  })
})

describe('the sender wiring (index.ts is Deno, so its source is checked rather than run)', () => {
  const src = require('node:fs').readFileSync('supabase/functions/dpdp-monday-email/index.ts', 'utf8') as string
  test('the block is fetched per organisation, only recorded on a real send, attached only to whole-organisation members who have not stopped the weekly e-mail, and fails open', () => {
    expect(src).toContain('"dpdp_timer_icp_weekly"')
    expect(src).toContain('p_record: !dryRun')
    expect(src).toContain('!d.statutoryOnly && viewers.has(d.membershipId)')
    expect(src).toContain('recorded: !dryRun')
    expect(src).toContain('DPDP_EMAIL_ICP_ENABLED')
    expect(src.indexOf('dpdp_timer_icp_weekly')).toBeLessThan(src.indexOf('await deliverDigests(sb, digests, dryRun, summary)'))
  })
})
