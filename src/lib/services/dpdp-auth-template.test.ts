/// <reference types="bun-types" />
// The Supabase Auth magic-link template (supabase/auth-templates/). The auth project is SHARED with other apps, so only a DPDP sign-in (redirect_to on
// a DPDP host) gets the three-option design; every other redirect must still render the original text. Go's text/template is not available here, so a
// tiny evaluator for exactly the constructs the template uses (if / or / eq / else / end, {{ .Field }}, trim markers, comments) renders it.
//
// Run: bun test --isolate src/lib/services/dpdp-auth-template.test.ts
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (f: string) => readFileSync(new URL(`../../../supabase/auth-templates/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
type Data = Record<string, string>

function evalExpr(expr: string, data: Data): boolean | string {
  const e = expr.trim()
  const field = /^\.(\w+)$/.exec(e)
  if (field) return data[field[1]] ?? ''
  const str = /^"([^"]*)"$/.exec(e)
  if (str) return str[1]
  const call = /^\((.*)\)$/.exec(e)
  if (call) return evalExpr(call[1], data)
  const parts = splitArgs(e)
  const [fn, ...args] = parts
  if (fn === 'eq') return String(evalExpr(args[0], data)) === String(evalExpr(args[1], data))
  if (fn === 'or') return args.some((a) => Boolean(evalExpr(a, data)))
  throw new Error(`unsupported expression: ${e}`)
}
function splitArgs(s: string): string[] {
  const out: string[] = []
  let depth = 0, cur = '', q = false
  for (const ch of s.trim()) {
    if (ch === '"') q = !q
    if (!q && ch === '(') depth++
    if (!q && ch === ')') depth--
    if (!q && depth === 0 && /\s/.test(ch)) { if (cur) out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

export function renderGoTemplate(tpl: string, data: Data): string {
  // tokens: text and {{ actions }}, with {{- and -}} trimming adjacent whitespace
  const toks: Array<{ t: 'text' | 'act'; v: string }> = []
  const re = /\{\{(-?)([\s\S]*?)(-?)\}\}/g
  let last = 0, m: RegExpExecArray | null, trimNext = false
  while ((m = re.exec(tpl))) {
    let text = tpl.slice(last, m.index)
    if (trimNext) text = text.replace(/^\s+/, '')
    if (m[1] === '-') text = text.replace(/\s+$/, '')
    toks.push({ t: 'text', v: text })
    toks.push({ t: 'act', v: m[2].replace(/-$/, '') })
    trimNext = m[3] === '-' || /-$/.test(m[2])
    last = re.lastIndex
  }
  let tail = tpl.slice(last)
  if (trimNext) tail = tail.replace(/^\s+/, '')
  toks.push({ t: 'text', v: tail })

  let i = 0
  function block(stopAt: string[]): string {
    let out = ''
    while (i < toks.length) {
      const tk = toks[i]
      if (tk.t === 'text') { out += tk.v; i++; continue }
      const a = tk.v.trim()
      if (a.startsWith('/*')) { i++; continue }
      if (stopAt.includes(a)) return out
      if (a.startsWith('if ')) {
        const cond = Boolean(evalExpr(a.slice(3), data))
        i++
        const yes = block(['else', 'end'])
        let no = ''
        if (toks[i].v.trim() === 'else') { i++; no = block(['end']) }
        i++ // end
        out += cond ? yes : no
        continue
      }
      out += String(evalExpr(a, data))
      i++
    }
    return out
  }
  return block([])
}

const html = read('magic-link.html')
const subject = read('magic-link.subject.txt').trim()
const DATA = { Token: '12345678', TokenHash: 'HASH', ConfirmationURL: 'https://auth.example/verify?token=HASH&type=magiclink&redirect_to=X', SiteURL: 'https://dpdp.veridian-aios.com' }
const OLD_TEXT = ['<h2>Your sign-in link</h2>', '<p>Follow the link below to sign in. This link expires shortly and can only be used once.</p>', '<p><a href="https://auth.example/verify?token=HASH&type=magiclink&redirect_to=X">Sign in</a></p>']

describe('a DPDP sign-in gets the three options', () => {
  for (const host of ['https://dpdp.veridian-aios.com/app/', 'https://app.veridian-aios.com/app/', 'https://veridian-aios.com/app/', 'https://www.veridian-aios.com/app/']) {
    test(`redirect ${host}`, () => {
      const out = renderGoTemplate(html, { ...DATA, RedirectTo: host })
      expect(out).toContain('You are almost in')
      expect(out).toContain('Someone, hopefully you, asked to sign in to Veridian DPDP with this email address. Choose any ONE of the three ways below.')
      expect(out).toContain('Let your AI do the work')
      expect(out).toContain('Sign in and get my AI work link')
      expect(out).toContain('Copy the prompt into ChatGPT, Claude, Gemini, Grok, DeepSeek, z.ai or any AI chat. It reads what needs doing and helps you do it.')
      expect(out).toContain('Work on your own')
      expect(out).toContain('Open my workspace')
      expect(out).toContain('Already have the sign-in page open?')
      expect(out).toContain('12345678')
      expect(out).toContain('Do not forward this email')
      expect(out).toContain('Ignore this email')
      expect(out).not.toContain('Your sign-in link')
      expect(renderGoTemplate(subject, { ...DATA, RedirectTo: host })).toBe('Sign in to Veridian DPDP - choose how you want to continue')
    })
  }
  test('option 1 verifies on the auth server and lands on the AI Link settings; option 2 is the normal link; no AI link token anywhere', () => {
    const out = renderGoTemplate(html, { ...DATA, RedirectTo: 'https://dpdp.veridian-aios.com/app/' })
    expect(out).toContain('href="https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1/verify?token=HASH&type=magiclink&redirect_to=https://dpdp.veridian-aios.com/app/%3Fnext%3Dai-link"')
    expect(out).toContain(`href="${DATA.ConfirmationURL}"`)
    expect(out).not.toMatch(/\/ai\/[0-9a-f]{16,}/)
    expect(out).not.toContain('{{')
  })
})

describe('any other app sharing the auth project still gets the original e-mail', () => {
  for (const redirect of ['https://verdian-ai.vercel.app/auth/callback', 'http://localhost:3000/', 'https://other.example/app/', '', 'https://dpdp.veridian-aios.com/app/evil']) {
    test(`redirect "${redirect}"`, () => {
      const out = renderGoTemplate(html, { ...DATA, RedirectTo: redirect }).trim()
      expect(out).toBe(OLD_TEXT[0] + '\n\n' + OLD_TEXT[1] + '\n' + OLD_TEXT[2])
      expect(renderGoTemplate(subject, { ...DATA, RedirectTo: redirect })).toBe('Your sign-in link')
    })
  }
})

describe('brevity', () => {
  test('the DPDP e-mail is short', () => {
    const text = renderGoTemplate(html, { ...DATA, RedirectTo: 'https://dpdp.veridian-aios.com/app/' }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    expect(text.split(' ').length).toBeLessThan(140)
  })
})
