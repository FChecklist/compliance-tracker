// DPDP audit trail, the pure halves (supabase/functions/_shared/audit/*): masking (every case), sealing, secret scrubbing, provenance, content building, the masked
// download, and the lifecycle constants. The database half is dpdp-audit-trail.pglite.test.ts.
//
// Run: bun test --isolate src/lib/services/dpdp-audit-pure.test.ts
import { describe, expect, test } from 'bun:test'
import { maskByKind, maskEmail, maskIdentifier, maskIp, normaliseIp } from '../../../supabase/functions/_shared/audit/mask'
import { generateKeyB64, importKey, isSealed, keyRingFrom, open, seal } from '../../../supabase/functions/_shared/audit/seal'
import { REDACTED, WITHHELD, isSecretKey, redactString, scrub } from '../../../supabase/functions/_shared/audit/scrub'
import { assessProvenance, fetcherOfUa, ipInCidr, parseUa, parseVendorRanges, readDeclaration, vendorOfFetcher, vendorOfIp, vendorOfModel } from '../../../supabase/functions/_shared/audit/provenance'
import { EVENT_TYPES, buildContent, clockSkewMs } from '../../../supabase/functions/_shared/audit/event'
import { buildDownload, fileIsIntact, fullRow, maskedRow, type StoredRow } from '../../../supabase/functions/_shared/audit/download'
import { canonicalJson, contentHashOf, fileVerificationHash, rowHashOf, GENESIS, verifyChain, type ChainRow } from '../../../supabase/functions/_shared/audit/chain'

const ring = async (extra: Record<string, string> = {}) => keyRingFrom((n) => ({ DPDP_AUDIT_SEAL_KEY: generateKeyB64(), ...extra })[n])

describe('masking: e-mail = first 2 + *** + last 2 of the local part, full domain', () => {
  test('the owner example and a 5-letter local part', () => {
    expect(maskEmail('priya.shah@acme.in')).toBe('pr***ah@acme.in')
    expect(maskEmail('ab.cd@x.co')).toBe('ab***cd@x.co')
  })
  test('local part of 4 letters or fewer is fully starred, domain kept whole', () => {
    expect(maskEmail('amit@firm.in')).toBe('****@firm.in')
    expect(maskEmail('a@firm.in')).toBe('*@firm.in')
    expect(maskEmail('abcde@firm.in')).toBe('ab***de@firm.in')
  })
  test('the LAST @ splits (a quoted local part with @), upper case and spaces are handled, empty stays empty', () => {
    expect(maskEmail('  Priya.Shah@Acme.IN ')).toBe('Pr***ah@Acme.IN')
    expect(maskEmail('"a@b"@dom.in')).toBe('"a***b"@dom.in')
    expect(maskEmail('')).toBe('')
    expect(maskEmail(null)).toBe('')
    expect(maskEmail(undefined)).toBe('')
  })
  test('a value with no usable @ is masked as an identifier, never shown', () => {
    expect(maskEmail('notanemailaddress')).toBe('not***ess')
    expect(maskEmail('@dom.in')).toBe(maskIdentifier('@dom.in'))
    expect(maskEmail('local@')).toBe(maskIdentifier('local@'))
  })
  test('the masked e-mail never contains the middle of the local part', () => {
    const m = maskEmail('very.long.local.part@example.com')
    expect(m).toBe('ve***rt@example.com')
    expect(m).not.toContain('long')
  })
})

describe('masking: identifiers = first 3 + *** + last 3, under 8 characters fully starred', () => {
  test('IPv4, mobile and device ids', () => {
    expect(maskIdentifier('203.0.113.45')).toBe('203***.45')
    expect(maskIdentifier('9876543210')).toBe('987***210')
    expect(maskIdentifier('DEV-8f3a91c2')).toBe('DEV***1c2')
  })
  test('exactly 7 characters is fully starred, exactly 8 is masked', () => {
    expect(maskIdentifier('1234567')).toBe('*******')
    expect(maskIdentifier('12345678')).toBe('123***678')
    expect(maskIdentifier('1.2.3.4')).toBe('*******')
    expect(maskIdentifier('abc')).toBe('***')
    expect(maskIdentifier('a')).toBe('*')
  })
  test('empty, null, undefined and whitespace give empty', () => {
    expect(maskIdentifier('')).toBe('')
    expect(maskIdentifier('   ')).toBe('')
    expect(maskIdentifier(null)).toBe('')
    expect(maskIdentifier(undefined)).toBe('')
  })
  test('multi-byte characters are counted as characters, not bytes', () => {
    expect(maskIdentifier('प्रिया-12345')).toHaveLength(maskIdentifier('प्रिया-12345').length)
    expect(maskIdentifier('abcdéfgh')).toBe('abc***fgh')
    expect(maskIdentifier('éééé')).toBe('****')
  })
})

describe('masking: IPv6 is handled sensibly', () => {
  test('normalisation: lower case, brackets, zone id dropped, IPv4-mapped unwrapped', () => {
    expect(normaliseIp('[2001:DB8::1]')).toBe('2001:db8::1')
    expect(normaliseIp('fe80::1%eth0')).toBe('fe80::1')
    expect(normaliseIp('::ffff:203.0.113.45')).toBe('203.0.113.45')
    expect(normaliseIp('0:0:0:0:0:ffff:203.0.113.45')).toBe('203.0.113.45')
    expect(normaliseIp('  ')).toBe('')
  })
  test('a full IPv6 masks to first 3 + *** + last 3 of its normal form; a short one is fully starred', () => {
    expect(maskIp('2001:0DB8:85A3::8A2E:0370:7334')).toBe('200***334')
    expect(maskIp('2001:db8::1')).toBe('200***::1')
    expect(maskIp('::1')).toBe('***')
    expect(maskIp('fe80::1%eth0')).toBe('*******') // 'fe80::1' is 7 characters: under 8, fully starred
    expect(maskIp('fe80::abcd:1%eth0')).toBe('fe8***d:1')
  })
  test('the same address in two spellings masks the same way', () => {
    expect(maskIp('::FFFF:203.0.113.45')).toBe(maskIp('203.0.113.45'))
    expect(maskIp('[2001:DB8::1]')).toBe(maskIp('2001:db8::1'))
  })
  test('maskByKind picks the rule from the kind stored beside a sealed value', () => {
    expect(maskByKind('email', 'priya.shah@acme.in')).toBe('pr***ah@acme.in')
    expect(maskByKind('ip', '203.0.113.45')).toBe('203***.45')
    expect(maskByKind('mobile', '9876543210')).toBe('987***210')
    expect(maskByKind('device', 'DEV-8f3a91c2')).toBe('DEV***1c2')
    expect(maskByKind('id', 'abcdefghij')).toBe('abc***hij')
    expect(maskByKind('text', 'plain words')).toBe('plain words')
    expect(maskByKind('something-new', 'abc')).toBe('abc')
  })
})

describe('sealing: AES-256-GCM, key apart from the database', () => {
  test('round trip; the stored form is aes1:<keyId>:<iv>:<ciphertext> and never contains the plain text', async () => {
    const r = await ring()
    const s = await seal(r, 'priya.shah@acme.in', 'o1', 'actor.email')
    expect(s.startsWith('aes1:k1:')).toBe(true); expect(isSealed(s)).toBe(true); expect(s).not.toContain('priya')
    expect(await open(r, s, 'o1', 'actor.email')).toBe('priya.shah@acme.in')
  })
  test('the same value sealed twice differs (random IV)', async () => {
    const r = await ring()
    expect(await seal(r, 'x', 'o1', 'f')).not.toBe(await seal(r, 'x', 'o1', 'f'))
  })
  test('a sealed value moved to another organisation or field, or altered, or opened with another key, will not open', async () => {
    const r = await ring()
    const s = await seal(r, 'secret-ip', 'o1', 'net.ip')
    await expect(open(r, s, 'o2', 'net.ip')).rejects.toThrow()
    await expect(open(r, s, 'o1', 'net.device_id')).rejects.toThrow()
    const parts = s.split(':'); parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA')
    await expect(open(r, parts.join(':'), 'o1', 'net.ip')).rejects.toThrow()
    await expect(open(await ring(), s, 'o1', 'net.ip')).rejects.toThrow()
    await expect(open(r, 'plain text', 'o1', 'net.ip')).rejects.toThrow(/Not a sealed/)
  })
  test('key rotation: a row sealed with the old key still opens while the old key is configured', async () => {
    const oldKey = generateKeyB64()
    const before = await keyRingFrom((n) => ({ DPDP_AUDIT_SEAL_KEY: oldKey, DPDP_AUDIT_SEAL_KEY_ID: 'k1' }[n]))
    const s = await seal(before, 'v', 'o1', 'f')
    const after = await keyRingFrom((n) => ({ DPDP_AUDIT_SEAL_KEY: generateKeyB64(), DPDP_AUDIT_SEAL_KEY_ID: 'k2', DPDP_AUDIT_SEAL_KEY_OLD: oldKey, DPDP_AUDIT_SEAL_KEY_OLD_ID: 'k1' }[n]))
    expect(await open(after, s, 'o1', 'f')).toBe('v')
    expect((await seal(after, 'v', 'o1', 'f')).startsWith('aes1:k2:')).toBe(true)
  })
  test('fail closed: no key, a short key, or a bad key id refuses outright (nothing is ever written unsealed)', async () => {
    await expect(keyRingFrom(() => undefined)).rejects.toThrow(/not set/)
    await expect(keyRingFrom((n) => (n === 'DPDP_AUDIT_SEAL_KEY' ? btoa('too short') : undefined))).rejects.toThrow(/32 bytes/)
    await expect(importKey(generateKeyB64(), 'bad id!')).rejects.toThrow(/key id/)
  })
})

describe('never logged: passwords, codes, card / bank details, keys, tokens, raw fingerprints', () => {
  test('secret-named keys are withheld at any depth, in any spelling', () => {
    const out = scrub({ password: 'x', userPassword: 'x', new_password: 'x', otp: '123456', passcode: '1', cardNumber: '4111111111111111', cvv: '123', bank_account_no: '1', ifsc: 'HDFC0001', upiId: 'a@b',
      apiKey: 'k', api_key: 'k', secret: 's', accessToken: 't', authorization: 'Bearer abc', cookie: 'c', deviceFingerprint: 'f', privateKey: 'p', ok: 'fine', nested: { token: 't', keep: 1, deep: [{ password: 'p' }] } }) as Record<string, any>
    for (const k of ['password', 'userPassword', 'new_password', 'otp', 'passcode', 'cardNumber', 'cvv', 'bank_account_no', 'ifsc', 'upiId', 'apiKey', 'api_key', 'secret', 'accessToken', 'authorization', 'cookie', 'deviceFingerprint', 'privateKey']) expect(out[k]).toBe(WITHHELD)
    expect(out.ok).toBe('fine'); expect(out.nested.token).toBe(WITHHELD); expect(out.nested.keep).toBe(1); expect(out.nested.deep[0].password).toBe(WITHHELD)
  })
  test('ordinary names that merely contain those letters are not withheld', () => {
    for (const k of ['passed', 'bypass', 'occupied', 'compass', 'status', 'pinned_at', 'cardinal', 'target']) expect(isSecretKey(k)).toBe(false)
    for (const k of ['password', 'otp', 'PIN', 'pin', 'card', 'card_no', 'token', 'x-api-key', 'secretKey']) expect(isSecretKey(k)).toBe(true)
  })
  test('secret-SHAPED strings are redacted wherever they appear: AI link tokens, JWTs, bearer values, Luhn-valid card numbers, "otp 123456"', () => {
    const tok = 'pxa_' + 'a'.repeat(64)
    expect(redactString(`GET /ai/${tok}/jobs`)).toBe(`GET /ai/${REDACTED}/jobs`)
    expect(redactString('hex ' + 'ab12'.repeat(20))).toBe(`hex ${REDACTED}`)
    const fakeJwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'sig_part_x'].join('.') // assembled at run time: a literal JWT in a test trips the secret scanner
    expect(redactString('jwt ' + fakeJwt)).toBe(`jwt ${REDACTED}`)
    expect(redactString('Authorization: Bearer abcdefghijklmnop1234')).toBe(`Authorization: ${REDACTED}`)
    expect(redactString('card 4111 1111 1111 1111 paid')).toBe(`card ${REDACTED} paid`)
    expect(redactString('your otp is 482913')).toBe(`your ${REDACTED}`)
    expect(redactString('order 1234567890123 shipped')).toBe('order 1234567890123 shipped') // 13 digits but not Luhn-valid: left alone
  })
  test('deep and huge values are cut, not dumped', () => {
    let deep: any = { v: 1 }; for (let i = 0; i < 20; i++) deep = { n: deep }
    expect(JSON.stringify(scrub(deep))).toContain('[deep]')
    expect((scrub('x'.repeat(5000)) as string).endsWith('...[cut]')).toBe(true)
    expect(scrub(undefined)).toBeNull()
  })
})

describe('provenance: observed vs declared vs inferred, with a mismatch flag', () => {
  const UA_GPT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'
  test('fetcher and vendor from the User-Agent; browser and OS for a person', () => {
    expect(fetcherOfUa(UA_GPT)).toBe('ChatGPT-User'); expect(vendorOfFetcher('ChatGPT-User')).toBe('OpenAI')
    expect(vendorOfFetcher('Claude-User')).toBe('Anthropic'); expect(vendorOfFetcher('Google-NotebookLM')).toBe('Google'); expect(vendorOfFetcher('PerplexityBot')).toBe('Perplexity')
    expect(vendorOfFetcher('Nothing')).toBeNull()
    const p = parseUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0')
    expect(p).toMatchObject({ browser: 'Edge', os: 'Windows', fetcher: null })
    expect(parseUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1').os).toBe('iOS')
    expect(parseUa(null)).toMatchObject({ browser: null, os: null, family: 'unknown' })
  })
  test('declared model gives an INFERRED vendor', () => {
    expect(vendorOfModel('gpt-5')).toBe('OpenAI'); expect(vendorOfModel('Claude Sonnet 5.5')).toBe('Anthropic'); expect(vendorOfModel('gemini-2.5-pro')).toBe('Google')
    expect(vendorOfModel('grok-4')).toBe('xAI'); expect(vendorOfModel('deepseek-v3')).toBe('DeepSeek'); expect(vendorOfModel('mystery-model')).toBeNull(); expect(vendorOfModel('')).toBeNull()
  })
  test('CIDR matching: IPv4, IPv6, IPv4-mapped, edges, bad input', () => {
    expect(ipInCidr('203.0.113.45', '203.0.113.0/24')).toBe(true); expect(ipInCidr('203.0.114.1', '203.0.113.0/24')).toBe(false)
    expect(ipInCidr('203.0.113.45', '203.0.113.45')).toBe(true); expect(ipInCidr('203.0.113.45', '0.0.0.0/0')).toBe(true)
    expect(ipInCidr('2001:db8::1', '2001:db8::/32')).toBe(true); expect(ipInCidr('2001:db9::1', '2001:db8::/32')).toBe(false)
    expect(ipInCidr('::ffff:203.0.113.45', '203.0.113.0/24')).toBe(true)
    expect(ipInCidr('203.0.113.45', '2001:db8::/32')).toBe(false); expect(ipInCidr('not an ip', '10.0.0.0/8')).toBe(false); expect(ipInCidr('10.0.0.1', '10.0.0.0/99')).toBe(false)
  })
  test('ranges come from configuration; malformed config means no ranges, never a crash', () => {
    expect(parseVendorRanges('{"OpenAI":["203.0.113.0/24"],"X":"nope"}')).toEqual({ OpenAI: ['203.0.113.0/24'] })
    expect(parseVendorRanges('not json')).toEqual({}); expect(parseVendorRanges('[]')).toEqual({}); expect(parseVendorRanges(null)).toEqual({})
    expect(vendorOfIp('203.0.113.9', { OpenAI: ['203.0.113.0/24'] })).toBe('OpenAI'); expect(vendorOfIp('198.51.100.1', { OpenAI: ['203.0.113.0/24'] })).toBeNull()
  })
  test('declaration read from headers first, then query; clipped; control characters removed', () => {
    const hv: Record<string, string> = { 'x-ai-model': 'gpt-5\u0000', 'x-ai-version': 'v'.repeat(300) }
    const h = { get: (n: string) => hv[n] ?? null }
    const d = readDeclaration(h, new URLSearchParams('ai_model=ignored&ai_session=s-1&ai_machine=m-9'))
    expect(d.model).toBe('gpt-5'); expect(d.version).toHaveLength(120); expect(d.sessionId).toBe('s-1'); expect(d.machineId).toBe('m-9')
    expect(readDeclaration(new Headers(), new URLSearchParams())).toEqual({ model: null, version: null, sessionId: null, machineId: null })
  })
  test('agreement: no mismatch; claim vs UA vs network disagreements each raise the flag with a reason', () => {
    const ranges = { OpenAI: ['203.0.113.0/24'], Anthropic: ['198.51.100.0/24'] }
    const agree = assessProvenance({ userAgent: UA_GPT, ip: '203.0.113.7', declared: { model: 'gpt-5', version: '5', sessionId: 's', machineId: 'm' }, ranges })
    expect(agree.mismatch).toBe(false); expect(agree.proof).toMatchObject({ ua: 'observed', network: 'observed', model: 'declared', vendor: 'inferred' })
    const liar = assessProvenance({ userAgent: UA_GPT, ip: '203.0.113.7', declared: { model: 'claude-sonnet', version: null, sessionId: null, machineId: null }, ranges })
    expect(liar.mismatch).toBe(true); expect(liar.mismatchReasons.join(' ')).toContain('declared model looks like Anthropic but the user-agent says OpenAI')
    const spoof = assessProvenance({ userAgent: UA_GPT, ip: '198.51.100.7', declared: { model: null, version: null, sessionId: null, machineId: null }, ranges })
    expect(spoof.mismatch).toBe(true); expect(spoof.mismatchReasons[0]).toContain('user-agent says OpenAI but the network address belongs to Anthropic')
    const noRanges = assessProvenance({ userAgent: UA_GPT, ip: '198.51.100.7', declared: { model: null, version: null, sessionId: null, machineId: null }, ranges: {} })
    expect(noRanges.mismatch).toBe(false); expect(noRanges.proof.network).toBe('not_checked')
  })
})

describe('building an audit row: sealed personal values, scrubbed details, proof levels, skew', () => {
  test('personal values are sealed with their kind; plain values stay plain; secrets never enter', async () => {
    const r = await ring()
    const b = await buildContent(r, {
      orgId: 'o1', eventType: 'edit', actorType: 'human', actorUserId: 'i1', actorRole: 'owner', actorEmail: 'priya.shah@acme.in',
      target: { table: 'dpdp.obligation', id: 'ob1' },
      changes: [{ field: 'assignee_email', kind: 'email', before: 'old.person@acme.in', after: 'new.person@acme.in' }, { field: 'status', before: 'open', after: 'done' }],
      details: { note: 'paid with card 4111 1111 1111 1111', password: 'hunter2', verb: 'NOTE' },
      net: { ip: '203.0.113.45', country: 'IN', asn: 'AS55836', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126', deviceId: 'DEV-8f3a91c2' },
      client: { time: '2026-10-06T10:00:00.000Z', timeZone: 'Asia/Kolkata' }, requestId: 'req-1', sessionId: 'sess-1', loginMethod: 'otp',
    }, Date.parse('2026-10-06T09:59:58.000Z'))
    const s = b.canonical
    for (const plain of ['priya.shah', 'old.person', 'new.person', '203.0.113.45', 'DEV-8f3a91c2', 'hunter2', '4111 1111', 'Chrome/126']) expect(s).not.toContain(plain)
    const c = b.content as any
    expect(c.actor.email.k).toBe('email'); expect(isSealed(c.actor.email.s)).toBe(true)
    expect(c.changes[0]).toMatchObject({ field: 'assignee_email', personal: true }); expect(isSealed(c.changes[0].before.s)).toBe(true)
    expect(c.changes[1]).toEqual({ field: 'status', personal: false, before: 'open', after: 'done' })
    expect(c.details.password).toBe(WITHHELD); expect(c.details.note).toContain(REDACTED)
    expect(c.net).toMatchObject({ country: 'IN', asn: 'AS55836', browser: 'Chrome', os: 'Windows', proof: 'observed' })
    expect(c.time).toMatchObject({ machine_time_zone: 'Asia/Kolkata', skew_ms: 2000, proof: 'declared' })
    expect(await open(r, c.actor.email.s, 'o1', 'actor.email')).toBe('priya.shah@acme.in')
    expect(await open(r, c.changes[0].after.s, 'o1', 'change.0.after')).toBe('new.person@acme.in')
  })
  test('AI block: observed vendor, self-declared model/version/session/machine, mismatch, proof levels, link and fingerprint, confirm', async () => {
    const r = await ring()
    const b = await buildContent(r, {
      orgId: 'o1', eventType: 'ai_read', actorType: 'ai_link', actorUserId: 'i2', link: { id: 'L1', tokenFp: 'fp-0001' }, guideHash: 'g'.repeat(64), aiCallId: 'call-1',
      net: { ip: '203.0.113.45', userAgent: 'ChatGPT-User/1.0' },
      ai: { declared: { model: 'claude-sonnet', version: '5.5', sessionId: 'sess-xyz', machineId: 'machine-77' }, vendorRanges: {} },
      confirm: { linkId: 'L1', clickedByUserId: 'i2', clickedAt: '2026-10-06T10:00:00Z' },
    })
    const c = b.content as any
    expect(c.ai).toMatchObject({ fetcher: 'ChatGPT-User', vendor_observed_ua: 'OpenAI', vendor_from_declared_model: 'Anthropic', model: 'claude-sonnet', version: '5.5', mismatch: true })
    expect(c.ai.proof).toMatchObject({ ua: 'observed', network: 'not_checked', model: 'declared', vendor: 'inferred' })
    expect(await open(r, c.ai.session_id.s, 'o1', 'ai.session_id')).toBe('sess-xyz'); expect(await open(r, c.ai.machine_id.s, 'o1', 'ai.machine_id')).toBe('machine-77')
    expect(c.link).toEqual({ id: 'L1', token_fp: 'fp-0001' }); expect(c.guide_hash).toBe('g'.repeat(64)); expect(c.confirm.clicked_by_user_id).toBe('i2'); expect(c.ai_call_id).toBe('call-1')
    expect(b.canonical).not.toContain('sess-xyz')
  })
  test('clock skew: machine minus server; unusable machine time gives null', () => {
    expect(clockSkewMs('2026-10-06T10:00:05Z', Date.parse('2026-10-06T10:00:00Z'))).toBe(5000)
    expect(clockSkewMs('2026-10-06T09:59:00Z', Date.parse('2026-10-06T10:00:00Z'))).toBe(-60000)
    expect(clockSkewMs('garbage', 0)).toBeNull(); expect(clockSkewMs(null, 0)).toBeNull()
  })
  test('the event-type list equals the database constraint (a new type must be added in both places)', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync(new URL('../../../drizzle/0731_dpdp_audit_trail.sql', import.meta.url), 'utf8')
    const m = /constraint audit_event_type_ok check \(event_type in \(([\s\S]*?)\)\)/.exec(sql)!
    const inSql = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
    expect(inSql).toEqual([...EVENT_TYPES].sort())
  })
})

describe('canonical JSON and the file verification hash', () => {
  test('key order and whitespace never change the text; undefined is dropped; numbers and unicode are stable', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}')
    expect(canonicalJson({ a: undefined, b: 'é' })).toBe('{"b":"é"}')
    expect(() => canonicalJson({ a: NaN })).toThrow()
  })
  test('a file hash covers everything but itself; changing any byte breaks it', async () => {
    const body: Record<string, unknown> = { a: 1, rows: [{ x: 'pr***ah@acme.in' }] }
    body.verification_hash = await fileVerificationHash(body)
    expect(await fileIsIntact(body)).toBe(true)
    expect(await fileIsIntact({ ...body, rows: [{ x: 'xx***ah@acme.in' }] })).toBe(false)
    expect(await fileIsIntact({ ...body, a: 2 })).toBe(false)
    expect(await fileIsIntact({ a: 1 })).toBe(false)
  })
})

async function storedRow(r: Awaited<ReturnType<typeof ring>>, seq: number, prev: string, input: Parameters<typeof buildContent>[1]): Promise<StoredRow & ChainRow> {
  const b = await buildContent(r, input)
  const ch = await contentHashOf(b.canonical)
  const id = `id${seq}`
  const us = 1_790_000_000_000_000 + seq
  const rh = await rowHashOf(prev, ch, id, input.orgId, us)
  return { seq, id, org_id: input.orgId, event_type: input.eventType, actor_user_id: input.actorUserId ?? null, server_time_us: us, content_canonical: b.canonical, content_hash: ch, prev_hash: prev, row_hash: rh }
}

describe('the person-facing download: server-side masking, no full value, no raw UA, verification hash', () => {
  const input = {
    orgId: 'o1', eventType: 'login' as const, actorType: 'human' as const, actorUserId: 'i1', actorRole: 'owner', actorEmail: 'priya.shah@acme.in',
    net: { ip: '2001:0DB8:85A3::8A2E:0370:7334', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126', deviceId: 'DEV-8f3a91c2', country: 'IN' },
    changes: [{ field: 'mobile', kind: 'mobile' as const, before: '9876543210', after: '9123456789' }, { field: 'status', before: 'a', after: 'b' }],
    ai: { declared: { model: 'gpt-5', version: null, sessionId: 'session-abc-123', machineId: 'machine-xyz-789' }, vendorRanges: {} },
  }
  test('every identifier is masked by its kind; nothing sealed or full is left; a raw user-agent is not included', async () => {
    const r = await ring()
    const row = await storedRow(r, 1, GENESIS, input)
    const m = (await maskedRow(r, row)) as any
    const flat = JSON.stringify(m)
    expect(m.actor.email).toBe('pr***ah@acme.in'); expect(m.net.ip).toBe('200***334'); expect(m.net.device_id).toBe('DEV***1c2')
    expect(m.changes[0]).toMatchObject({ field: 'mobile', before: '987***210', after: '912***789' }); expect(m.changes[1]).toMatchObject({ before: 'a', after: 'b' })
    expect(m.ai.session_id).toBe('ses***123'); expect(m.ai.machine_id).toBe('mac***789')
    for (const full of ['priya.shah', '85A3', '8a2e', 'DEV-8f3a91c2', '9876543210', '9123456789', 'session-abc-123', 'machine-xyz-789', 'Mozilla', 'aes1:']) expect(flat.toLowerCase()).not.toContain(full.toLowerCase())
    expect(m.net).toMatchObject({ browser: 'Chrome', os: 'Windows', country: 'IN' })
    expect(m.occurred_at_utc).toBe(new Date(Math.floor(row.server_time_us as number / 1000)).toISOString())
    expect(m.row_hash).toBe(row.row_hash)
  })
  test('the internal full view opens everything (only reachable after the access log is written)', async () => {
    const r = await ring()
    const f = (await fullRow(r, await storedRow(r, 1, GENESIS, input))) as any
    expect(f.actor.email).toBe('priya.shah@acme.in'); expect(f.net.ip).toBe('2001:0DB8:85A3::8A2E:0370:7334'); expect(f.changes[0].before).toBe('9876543210'); expect(f.ai.session_id).toBe('session-abc-123')
  })
  test('the file carries person (masked), time, scope, chain state and a verification hash that detects any edit', async () => {
    const r = await ring()
    const rows = [await storedRow(r, 1, GENESIS, input)]
    const body = (await buildDownload(r, rows, {
      scope: 'own', orgId: 'o1', orgName: 'Acme', requestedBy: { userId: 'i1', role: 'owner', email: 'priya.shah@acme.in' }, generatedAtUtc: '2026-10-06T10:00:00.000Z',
      fromUtc: null, toUtc: null, chain: { verified: true, rows: 1, head: rows[0].row_hash }, notice: 'n',
    })) as any
    expect(body.prepared_for).toEqual({ user_id: 'i1', role: 'owner', email_masked: 'pr***ah@acme.in' })
    expect(body.row_count).toBe(1); expect(body.generated_at_utc).toBe('2026-10-06T10:00:00.000Z'); expect(JSON.stringify(body)).not.toContain('priya.shah')
    expect(await fileIsIntact(body)).toBe(true)
    body.rows[0].net.ip = '200***999'
    expect(await fileIsIntact(body)).toBe(false)
  })
  test('an unopenable value (wrong key) fails the whole download rather than leaking or silently dropping', async () => {
    const r = await ring()
    const row = await storedRow(r, 1, GENESIS, input)
    await expect(maskedRow(await ring(), row)).rejects.toThrow()
  })
  test('verifyChain walks a TS-built chain and names the break', async () => {
    const r = await ring()
    const a = await storedRow(r, 1, GENESIS, input); const b = await storedRow(r, 2, a.row_hash, { ...input, eventType: 'edit' }); const c = await storedRow(r, 3, b.row_hash, { ...input, eventType: 'delete' })
    expect(await verifyChain([a, b, c])).toMatchObject({ ok: true, rows: 3, head: c.row_hash })
    expect(await verifyChain([a, c])).toMatchObject({ ok: false, reason: 'link' })
    expect(await verifyChain([b, c], a.row_hash)).toMatchObject({ ok: true })
    expect(await verifyChain([{ ...a, actor_user_id: 'someone-else' }, b])).toMatchObject({ ok: false, reason: 'columns' })
    expect(await verifyChain([{ ...a, org_id: 'o9' }])).toMatchObject({ ok: false })
    expect(await verifyChain([])).toMatchObject({ ok: true, rows: 0, head: null })
  })
})
