/// <reference types="bun-types" />
// The pure half of the unfamiliar-use alert (supabase/functions/dpdp-ai-link/unfamiliar.ts) and the proxy header that feeds it.
import { describe, expect, test } from 'bun:test'
import { alertEmail, clientPrefix, uaFamily } from '../../../supabase/functions/dpdp-ai-link/unfamiliar'
import { proxyRequest } from '../../../dpdp-app/functions/ai/_proxy'

describe('clientPrefix keeps at most a /24 (IPv4) or /48 (IPv6)', () => {
  test('IPv4', () => {
    expect(clientPrefix('203.0.113.77')).toBe('203.0.113')
    expect(clientPrefix(' 10.1.2.3 ')).toBe('10.1.2')
  })
  test('IPv6, including a compressed address', () => {
    expect(clientPrefix('2001:db8:abcd:12::1')).toBe('2001:db8:abcd')
    expect(clientPrefix('2001:0DB8:0000:0001:0000:0000:0000:0001')).toBe('2001:db8:0')
    expect(clientPrefix('::1')).toBe('0:0:0')
  })
  test('anything else is nothing (never a guess)', () => {
    for (const bad of [null, undefined, '', 'not an ip', '999.1.1.1', '1.2.3', '1:2:3:4:5:6:7:8:9', 'zzzz::1']) expect(clientPrefix(bad as string | null)).toBeNull()
  })
})

describe('uaFamily is a short stable family name, not a version', () => {
  test('AI tools, scripts and browsers', () => {
    expect(uaFamily('Claude-User/1.0 (+https://claude.ai)')).toBe('Claude')
    expect(uaFamily('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0')).toBe('ChatGPT')
    expect(uaFamily('curl/8.4.0')).toBe('curl')
    expect(uaFamily('python-requests/2.31')).toBe('Python')
    expect(uaFamily('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36')).toBe('Chrome')
    expect(uaFamily('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0')).toBe('Edge')
  })
  test('a new version of the same tool is the same family; empty is unknown', () => {
    expect(uaFamily('curl/7.1')).toBe(uaFamily('curl/8.9'))
    expect(uaFamily('')).toBe('unknown')
    expect(uaFamily(null)).toBe('unknown')
    expect(uaFamily('SomeNewTool/3.2 (x)')).toBe('somenewtool')
  })
})

describe('alertEmail: plain, no link of any kind, says what to do', () => {
  const a = alertEmail({ alert: true, to: 'a@b.test', org: 'Acme <script>', role: 'staff', label: 'Monday email', newNetwork: true, newTool: true, at: '2026-10-05T00:00:00Z' })
  test('no address, no link, no token, and the organisation name is escaped', () => {
    expect(a.text + a.html).not.toMatch(/https?:\/\/|\/ai\/|www\./i)
    expect(a.text + a.html).not.toMatch(/[0-9a-f]{64}/)
    expect(a.html).not.toContain('<script>')
    expect(a.html).toContain('&lt;script&gt;')
  })
  test('says what happened, which role the AI works as, what to do if it was not them, and the once-a-day promise', () => {
    expect(a.text).toContain('from a place and a tool we have not seen with it before')
    expect(a.text).toContain('a staff member')
    expect(a.text).toContain('stop that link and make a new one')
    expect(a.text).toContain('at most one of these a day')
    expect(a.subject).toBe('Your VERIDIAN AI work link was just used from somewhere new')
  })
  test('only a new network, or only a new tool, say so', () => {
    expect(alertEmail({ alert: true, to: 'a@b.test', org: null, role: null, label: null, newNetwork: true, newTool: false, at: '' }).text).toContain('from a place we have not seen it used from before')
    expect(alertEmail({ alert: true, to: 'a@b.test', org: null, role: null, label: null, newNetwork: false, newTool: true, at: '' }).text).toContain('by a tool we have not seen it used with before')
  })
})

describe('the Pages proxy forwards the caller address for the alert, and only that header is added', () => {
  test('cf-connecting-ip becomes x-dpdp-client-ip; a spoofed x-dpdp-client-ip from the caller is not passed on', async () => {
    let seen: Record<string, string> = {}
    const fetchImpl = async (_u: string, init?: RequestInit) => { seen = (init?.headers ?? {}) as Record<string, string>; return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) }
    const tok = 'a'.repeat(64)
    await proxyRequest(new Request(`https://dpdp.veridian-aios.com/ai/${tok}/jobs`, { headers: { 'cf-connecting-ip': '203.0.113.9', 'x-dpdp-client-ip': '6.6.6.6', 'user-agent': 'curl/8' } }), [tok, 'jobs'], fetchImpl)
    expect(seen['x-dpdp-client-ip']).toBe('203.0.113.9')
    expect(seen['user-agent']).toBe('curl/8')
    await proxyRequest(new Request(`https://dpdp.veridian-aios.com/ai/${tok}/jobs`, { headers: { 'x-dpdp-client-ip': '6.6.6.6' } }), [tok, 'jobs'], fetchImpl)
    expect(seen['x-dpdp-client-ip']).toBeUndefined()
  })
})
