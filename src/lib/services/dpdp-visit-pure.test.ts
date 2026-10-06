/// <reference types="bun-types" />
// The pure parts of the visitor-journey tracking (supabase/functions/_shared/visit/*): what is kept of an IP address, bot detection, source classification, what a beacon may
// carry, and the funnel / conversion arithmetic. The database half is proven on real Postgres in dpdp-visitor-journey.pglite.test.ts; the routes in dpdp-track-handler.test.ts.
//
// Run: bun test --isolate src/lib/services/dpdp-visit-pure.test.ts
import { describe, expect, test } from 'bun:test'
import { hashIp, normaliseIp, shortenIp } from '../../../supabase/functions/_shared/visit/ip'
import { detectBot } from '../../../supabase/functions/_shared/visit/bots'
import { classifySource, cleanHost, cleanUtm } from '../../../supabase/functions/_shared/visit/source'
import { MAX_BODY_BYTES, MAX_EVENTS, cleanEvent, cleanPath, validateBeacon } from '../../../supabase/functions/_shared/visit/beacon'
import { conversionBySource, normaliseRows, pct, reportToMarkdown, summariseFunnel, type FunnelRow } from '../../../supabase/functions/_shared/visit/funnel'

describe('IP: shortened form', () => {
  test('IPv4 keeps three octets and zeroes the last', () => {
    expect(shortenIp('203.0.113.77')).toBe('203.0.113.0')
    expect(shortenIp(' 10.1.2.255 ')).toBe('10.1.2.0')
  })
  test('IPv6 is cut to its /48 whatever the spelling', () => {
    expect(shortenIp('2001:db8:abcd:12:ffff:1:2:3')).toBe('2001:db8:abcd::')
    expect(shortenIp('2001:0DB8:ABCD::1')).toBe('2001:db8:abcd::')
    expect(shortenIp('::1')).toBe('0:0:0::')
    expect(shortenIp('[2001:db8::1]')).toBe('2001:db8:0::')
  })
  test('an IPv4-mapped IPv6 address is the IPv4 address', () => {
    expect(shortenIp('::ffff:203.0.113.9')).toBe('203.0.113.0')
    expect(normaliseIp('::ffff:cb00:7109')?.text).toBe('203.0.113.9')
  })
  test('anything that is not an address gives null, never a guess', () => {
    for (const bad of ['', null, undefined, 'abc', '256.1.1.1', '1.2.3', '1.2.3.4.5', '2001:db8::zz', '1:2:3:4:5:6:7:8:9', 'x'.repeat(100)]) expect(shortenIp(bad as string)).toBeNull()
  })
})

describe('IP: keyed hash', () => {
  const KEY = 'k'.repeat(32)
  test('the same address gives the same 64-hex hash, whatever the spelling', async () => {
    const a = await hashIp('203.0.113.9', KEY)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
    expect(await hashIp(' 203.0.113.9', KEY)).toBe(a)
    expect(await hashIp('::ffff:203.0.113.9', KEY)).toBe(a)
    expect(await hashIp('2001:db8::1', KEY)).toBe(await hashIp('2001:0db8:0:0:0:0:0:1', KEY))
  })
  test('a different address or a different key gives a different hash; the hash contains no part of the address', async () => {
    const a = await hashIp('203.0.113.9', KEY)
    expect(await hashIp('203.0.113.10', KEY)).not.toBe(a)
    expect(await hashIp('203.0.113.9', 'z'.repeat(32))).not.toBe(a)
    expect(a).not.toContain('203')
  })
  test('it is a keyed HMAC: it differs from a plain SHA-256 of the address (so it cannot be reversed by trying all addresses)', async () => {
    const plain = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ip:203.0.113.9'))), (b) => b.toString(16).padStart(2, '0')).join('')
    expect(await hashIp('203.0.113.9', KEY)).not.toBe(plain)
  })
  test('no key (or a short one) = no hash: it never falls back to an unkeyed hash; an invalid address = no hash', async () => {
    expect(await hashIp('203.0.113.9', '')).toBeNull()
    expect(await hashIp('203.0.113.9', undefined)).toBeNull()
    expect(await hashIp('203.0.113.9', 'short')).toBeNull()
    expect(await hashIp('not an ip', KEY)).toBeNull()
  })
})

describe('bots', () => {
  test('named crawlers are recognised', () => {
    expect(detectBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toEqual({ isBot: true, name: 'Googlebot' })
    expect(detectBot('Mozilla/5.0 (compatible; bingbot/2.0)').name).toBe('Bingbot')
    expect(detectBot('Mozilla/5.0 AppleWebKit/605.1.15 (Applebot/0.1)').name).toBe('Applebot')
    expect(detectBot('Mozilla/5.0; compatible; ClaudeBot/1.0').name).toBe('Anthropic')
    expect(detectBot('Mozilla/5.0; compatible; OAI-SearchBot/1.0').name).toBe('OpenAI')
    expect(detectBot('Mozilla/5.0 (compatible; PerplexityBot/1.0)').name).toBe('Perplexity')
    expect(detectBot('Mozilla/5.0 (compatible; AhrefsBot/7.0)').name).toBe('SEO tool')
    expect(detectBot('Mozilla/5.0 (compatible; UptimeRobot/2.0)').name).toBe('Monitor')
  })
  test('generic scripts and headless tools are bots; an empty user agent is a bot', () => {
    for (const ua of ['curl/8.4.0', 'python-requests/2.31', 'Mozilla/5.0 HeadlessChrome/120', 'Go-http-client/1.1', 'node-fetch/1.0', 'some-crawler/1', '']) expect(detectBot(ua).isBot).toBe(true)
    expect(detectBot(null).isBot).toBe(true)
  })
  test('ordinary browsers are people', () => {
    for (const ua of [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36',
    ]) expect(detectBot(ua)).toEqual({ isBot: false, name: null })
  })
})

describe('source classification', () => {
  test('no referrer is direct; our own host is internal', () => {
    expect(classifySource({}).kind).toBe('direct')
    expect(classifySource({ referrerHost: 'dpdp.veridian-aios.com' }).kind).toBe('internal')
  })
  test('search engines and AI assistants are search, with their name', () => {
    expect(classifySource({ referrerHost: 'www.google.co.in' })).toMatchObject({ kind: 'search', searchEngine: 'Google' })
    expect(classifySource({ referrerHost: 'duckduckgo.com' })).toMatchObject({ kind: 'search', searchEngine: 'DuckDuckGo' })
    expect(classifySource({ referrerHost: 'chatgpt.com' })).toMatchObject({ kind: 'search', searchEngine: 'ChatGPT' })
    expect(classifySource({ referrerHost: 'www.perplexity.ai' }).searchEngine).toBe('Perplexity')
  })
  test('social and other sites', () => {
    expect(classifySource({ referrerHost: 'www.linkedin.com' }).kind).toBe('social')
    expect(classifySource({ referrerHost: 'lnkd.in' }).kind).toBe('social')
    expect(classifySource({ referrerHost: 'some-blog.example.org' })).toMatchObject({ kind: 'referral', referrerHost: 'some-blog.example.org' })
  })
  test('campaign tags make it a campaign (even with a search referrer) and e-mail medium makes it e-mail', () => {
    expect(classifySource({ referrerHost: 'google.com', utm: { source: 'Newsletter-Oct', medium: 'CPC', campaign: 'Launch' } })).toMatchObject({ kind: 'campaign', utm: { source: 'newsletter-oct', medium: 'cpc', campaign: 'launch' } })
    expect(classifySource({ utm: { source: 'monday', medium: 'email' } }).kind).toBe('email')
  })
  test('an e-mail address or a token pasted into a campaign tag is dropped, not stored', () => {
    expect(cleanUtm('priya@acme.in')).toBeNull()
    expect(cleanUtm('a'.repeat(30))).toBeNull()
    expect(cleanUtm('has <script>')).toBeNull()
    expect(classifySource({ utm: { source: 'priya@acme.in' } }).kind).toBe('direct')
  })
  test('a referrer that is not a plain host is ignored', () => {
    expect(cleanHost('https://www.google.com/search?q=secret')).toBe('www.google.com')
    expect(cleanHost('localhost')).toBeNull()
    expect(cleanHost('a b.com')).toBeNull()
    expect(cleanHost(42)).toBeNull()
  })
})

describe('beacon validation: what may be stored', () => {
  const ok = (over: Record<string, unknown> = {}) => ({ sid: 'ab'.repeat(8), vid: 'cd'.repeat(12), p: '/dpdp-firm/', d: 'mobile', l: 'en-IN', e: [{ k: 'pv', p: '/dpdp-firm/' }], ...over })
  const run = (b: unknown) => validateBeacon(typeof b === 'string' ? b : JSON.stringify(b))

  test('a normal beacon passes with its source, device, language and events', () => {
    const r = run(ok({ r: 'www.google.com', u: { c: 'launch' }, e: [{ k: 'pv', p: '/dpdp-firm/' }, { k: 'sec', p: '/dpdp-firm/', n: 'pricing', ms: 12000 }, { k: 'cta', p: '/', n: '/app/' }, { k: 'choice', p: '/', n: 'edition', v: 'ca-firm' }, { k: 'exit', p: '/dpdp-firm/', n: 'pricing', ms: 41000, sc: 80 }] }))
    expect(r.ok).toBe(true)
    if (r.ok && !r.beacon.off) {
      expect(r.beacon.source.kind).toBe('campaign')
      expect(r.beacon.device).toBe('mobile'); expect(r.beacon.language).toBe('en-in')
      expect(r.beacon.events.map((e) => e.k)).toEqual(['pv', 'sec', 'cta', 'choice', 'exit'])
    }
  })
  test('over 6 KB is refused with 413; not JSON, an array, or no page is a 400', () => {
    const big = run(ok({ e: [{ k: 'pv', p: '/', pad: 'x'.repeat(MAX_BODY_BYTES) }] }))
    expect(big).toMatchObject({ ok: false, status: 413 })
    expect(run('not json')).toMatchObject({ ok: false, status: 400 })
    expect(run('[]')).toMatchObject({ ok: false, status: 400 })
    expect(run(ok({ p: undefined }))).toMatchObject({ ok: false, status: 400 })
    expect(run(ok({ sid: 'zz' }))).toMatchObject({ ok: false, status: 400 })
  })
  test('private paths are never accepted as the page, and token-looking paths are refused', () => {
    for (const p of ['/app/', '/app', '/act/xyz', '/unsubscribe/', '/p/abc', '/copy/', '/ai/token', '/api/visit', '//evil.com', '/a'.repeat(1) + '/' + 'T'.repeat(40)]) expect(run(ok({ p })).ok).toBe(false)
  })
  test('query and fragment are cut from every path', () => {
    expect(cleanPath('/dpdp-firm/?ref=ABC123&utm_source=x#pricing')).toBe('/dpdp-firm/')
    expect(cleanPath('/index.html')).toBe('/')
    expect(cleanPath('/pricing/index.html')).toBe('/pricing/')
  })
  test('events: private-page events and the signed-in route name rule', () => {
    expect(cleanEvent({ k: 'pv', p: '/app/' })).toBeNull()
    expect(cleanEvent({ k: 'pv', p: 'app:home' })).toMatchObject({ k: 'pv', p: 'app:home' })
    expect(cleanEvent({ k: 'pv', p: 'app:home/../x' })).toBeNull()
  })
  test('nothing personal gets through a name or a value: e-mails, spaces, tokens, typed text, wrong types are dropped', () => {
    for (const e of [
      { k: 'cta', n: 'priya@acme.in' }, { k: 'cta', n: 'call 9876543210 now' }, { k: 'choice', n: 'edition', v: 'priya@acme.in' }, { k: 'choice', n: 'name', v: 'Priya Shah' },
      { k: 'choice', n: 'x', v: 'A'.repeat(30) }, { k: 'sec', p: '/', n: 'T'.repeat(30), ms: 1 }, { k: 'step', n: 'a b' }, { k: 'choice', n: 'edition' }, { k: 'nope', p: '/' }, null, 'str', 5,
    ]) expect(cleanEvent(e)).toBeNull()
  })
  test('numbers are clamped; an exit scroll is at most 100', () => {
    expect(cleanEvent({ k: 'exit', p: '/', ms: 9e12, sc: 500 })).toMatchObject({ ms: 86_400_000, sc: 100 })
    expect(cleanEvent({ k: 'sec', p: '/', n: 'how', ms: -5 })).toMatchObject({ ms: 0 })
    expect(cleanEvent({ k: 'sec', p: '/', n: 'how', ms: 'abc' })).toMatchObject({ ms: null })
  })
  test('at most 25 events are read from one beacon', () => {
    const r = run(ok({ e: Array.from({ length: 80 }, () => ({ k: 'pv', p: '/' })) }))
    expect(r.ok && !r.beacon.off ? r.beacon.events.length : -1).toBe(MAX_EVENTS)
  })
  test('the privacy signal beacon carries no visitor id and no session id even if the script sent one', () => {
    const r = run({ off: 1, p: '/dpdp-firm/', d: 'desktop', vid: 'cd'.repeat(12), sid: 'ab'.repeat(8), e: [{ k: 'pv', p: '/' }] })
    expect(r).toEqual({ ok: true, beacon: { off: true, path: '/dpdp-firm/', device: 'desktop' } })
  })
  test('a visitor id that is not hex is dropped, not stored', () => {
    const r = run(ok({ vid: 'priya@acme.in' }))
    expect(r.ok && !r.beacon.off ? r.beacon.vid : 'x').toBeNull()
  })
})

describe('funnel arithmetic', () => {
  const rows: FunnelRow[] = [
    { source_kind: 'search', source_detail: 'Google', visits: 200, key_page: 120, cta: 50, signed_up: 20, org_created: 12, wizard_done: 9, paid: 4 },
    { source_kind: 'social', source_detail: 'www.linkedin.com', visits: 50, key_page: 30, cta: 12, signed_up: 6, org_created: 3, wizard_done: 2, paid: 2 },
    { source_kind: 'direct', source_detail: '', visits: 100, key_page: 40, cta: 10, signed_up: 5, org_created: 2, wizard_done: 1, paid: 0 },
  ]
  test('percentages: one decimal, and an empty stage is 0%, never NaN', () => {
    expect(pct(1, 3)).toBe(33.3); expect(pct(2, 3)).toBe(66.7); expect(pct(5, 0)).toBe(0); expect(pct(0, 0)).toBe(0)
  })
  test('totals, share of all visits and of the previous step', () => {
    const s = summariseFunnel(rows)
    expect(s.map((x) => x.count)).toEqual([350, 190, 72, 31, 17, 12, 6])
    expect(s[0]).toMatchObject({ pctOfVisits: 100, pctOfPrevious: 100 })
    expect(s[3]).toMatchObject({ stage: 'signed_up', pctOfVisits: 8.9, pctOfPrevious: 43.1 })
    expect(s[6]).toMatchObject({ stage: 'paid', pctOfVisits: 1.7, pctOfPrevious: 50 })
  })
  test('converted by source: most paid first, with sign-up and sale rates', () => {
    const c = conversionBySource(rows)
    expect(c.map((x) => x.source)).toEqual(['search: Google', 'social: www.linkedin.com', 'direct'])
    expect(c[0]).toMatchObject({ visits: 200, signedUp: 20, paid: 4, visitToSignUp: 10, visitToPaid: 2 })
    expect(c[1]).toMatchObject({ visitToPaid: 4 })
  })
  test('the same source from two rows is merged; ties break on sign-ups then visits', () => {
    const c = conversionBySource([...rows, { source_kind: 'search', source_detail: 'Google', visits: 10, key_page: 0, cta: 0, signed_up: 1, org_created: 0, wizard_done: 0, paid: 1 }])
    expect(c[0]).toMatchObject({ source: 'search: Google', visits: 210, paid: 5 })
  })
  test('rows from the database (bigints as strings, nulls) are normalised', () => {
    expect(normaliseRows([{ source_kind: 'direct', source_detail: null, visits: '7', key_page: '3', cta: null, signed_up: 1, org_created: 0, wizard_done: 0, paid: 0 }])).toEqual([{ source_kind: 'direct', source_detail: '', visits: 7, key_page: 3, cta: 0, signed_up: 1, org_created: 0, wizard_done: 0, paid: 0 }])
    expect(normaliseRows('nope')).toEqual([])
    expect(summariseFunnel([]).every((x) => x.count === 0 && x.pctOfVisits === 0)).toBe(true)
  })
  test('the Markdown report names the funnel, the sources and the crawlers, and never breaks a table with a pipe', () => {
    const md = reportToMarkdown({ days: 30, totals: { human_visitors: 300, human_sessions: 350, returning_visitors: 20, bot_sessions: 80 }, count_only_visits: 5, sources: [{ kind: 'search', detail: 'a|b', sessions: 9 }], bots: [{ bot: 'Googlebot', sessions: 80 }], exits: [], sections: [] }, rows)
    expect(md).toContain('# Visitor journey -- last 30 days')
    expect(md).toContain('| Paid | 6 | 1.7% | 50% |')
    expect(md).toContain('| search: Google | 200 | 20 | 4 | 10% | 2% |')
    expect(md).toContain('a/b')
    expect(md).toContain('| Googlebot | 80 |')
    expect(md).toContain('_nothing yet_')
  })
})
