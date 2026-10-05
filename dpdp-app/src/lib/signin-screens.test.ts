import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { BrandMark, CheckYourEmail, SIGNIN_BENEFITS, SignIn } from "../components/Screens"

// The sign-in / start screen and the Check your email pop-up (owner, 2026-10-05): the words, the field, the button, the brand mark, the numeric
// keypad, the one-time-code autofill, and that every benefit line is short (the owner's brevity rule).
const noop = () => {}

describe("SignIn: sign in or start free", () => {
  const html = renderToStaticMarkup(createElement(SignIn, { onSubmit: noop, busy: false, error: null }))
  test("offer, role pill, title, one email field, one clear button, reassurance, trust line, brand top right", () => {
    expect(html).toContain("Free to start. Pay only when you agree a price.")
    expect(html).toContain("For the business owner or compliance lead")
    expect(html).toContain(">Sign in or start free</h1>")
    expect(html).toContain(">Your email</label>")
    expect(html).not.toMatch(/work email/i)
    expect(html).toContain('autoComplete="email"')
    expect(html).toContain("Email me a sign-in link")
    expect(html).toContain("No password. We use your email to sign you in and to send your invoices.")
    expect(html).toContain("Built for India’s DPDP Act. We do not certify compliance.")
    expect(html).toContain('aria-label="Veridian DPDP"')
  })
  test("benefits: a list, short lines, two columns on wide screens and one on a phone, no banned claim words", () => {
    expect(html).toContain("sm:grid-cols-2")
    expect(SIGNIN_BENEFITS.length).toBeGreaterThanOrEqual(6)
    expect(SIGNIN_BENEFITS.length).toBeLessThanOrEqual(8)
    for (const b of SIGNIN_BENEFITS) {
      expect(b.text.split(/\s+/).length, b.text).toBeLessThanOrEqual(12)
      expect(b.text, b.text).not.toMatch(/\b(best|only|certified|guarantee|guaranteed|leading|fastest|world.class|100%)\b/i)
      expect(html).toContain(b.text)
    }
  })
})

describe("CheckYourEmail pop-up", () => {
  const html = renderToStaticMarkup(createElement(CheckYourEmail, { email: "me@example.test", resend: "idle", error: null, onResend: noop, onUseAnother: noop, onVerify: async () => null }))
  test("copy: eyebrow, title, body, label, two buttons, the small line, brand next to close", () => {
    expect(html).toContain("Check your inbox")
    expect(html).toContain(">Check your email</h1>")
    expect(html).toContain("We sent an email to <b>me@example.test</b>. Tap a button in it, or type the passcode here.")
    expect(html).toContain(">Passcode</label>")
    expect(html).toContain(">Sign in</button>")
    expect(html).toContain("Send me a new code")
    expect(html).toContain("Did not arrive after a minute? Check spam, or send a new code.")
    expect(html).toContain('aria-label="Close and use a different email"')
    expect(html.indexOf('aria-label="Veridian DPDP"')).toBeLessThan(html.indexOf('aria-label="Close and use a different email"'))
    expect(html).not.toMatch(/in production/i)
  })
  test("the passcode field: numeric keypad, one-time-code autofill, labelled, described", () => {
    expect(html).toContain('inputMode="numeric"')
    expect(html).toContain('autoComplete="one-time-code"')
    expect(html).toContain('aria-describedby="passcode-help"')
    expect(html).toContain('role="dialog"')
  })
  test("BrandMark names the product", () => {
    expect(renderToStaticMarkup(createElement(BrandMark))).toContain("VERIDIAN")
  })
})
