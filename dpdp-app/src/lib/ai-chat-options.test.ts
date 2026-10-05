import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AiPasteOptions } from "../components/AiPasteOptions"
import { COPIED_LINE, DO_NOT_FORWARD_NOTE, THIRD_PARTY_NOTE, chatOptions } from "./ai-chat-options"

const PASTE = "I use VERIDIAN, my organisation's DPDP software & I want help.\nMy link: https://dpdp.veridian-aios.com/ai/" + "a".repeat(64)

describe("chatOptions", () => {
  const o = Object.fromEntries(chatOptions(PASTE).map((x) => [x.id, x]))
  test("ChatGPT, Grok and Claude open with the whole paste encoded in the address", () => {
    expect(o.chatgpt.href).toBe(`https://chatgpt.com/?q=${encodeURIComponent(PASTE)}`)
    expect(o.grok.href).toBe(`https://grok.com/?q=${encodeURIComponent(PASTE)}`)
    expect(o.claude.href).toBe(`https://claude.ai/new?q=${encodeURIComponent(PASTE)}`)
    for (const k of ["chatgpt", "grok", "claude"]) expect(o[k].kind).toBe("open")
    expect(decodeURIComponent(o.chatgpt.href.split("?q=")[1])).toBe(PASTE)
  })
  test("Gemini, DeepSeek and z.ai copy first, then open the site", () => {
    expect(o.gemini.href.startsWith("https://gemini.google.com/app?q=")).toBe(true)
    expect(o.deepseek.href).toBe("https://chat.deepseek.com/")
    expect(o.zai.href).toBe("https://chat.z.ai/")
    for (const k of ["gemini", "deepseek", "zai"]) expect(o[k].kind).toBe("copy-open")
  })
  test("six buttons here; the seventh (plain Copy) is in the component", () => {
    expect(chatOptions(PASTE)).toHaveLength(6)
  })
})

describe("AiPasteOptions markup", () => {
  const html = renderToStaticMarkup(createElement(AiPasteOptions, { paste: PASTE, onReplace: () => {} }))
  test("every site button is a new-tab link with noopener noreferrer and the right origin", () => {
    for (const origin of ["https://chatgpt.com/", "https://grok.com/", "https://claude.ai/new", "https://gemini.google.com/app", "https://chat.deepseek.com/", "https://chat.z.ai/"]) {
      const start = html.indexOf(`<a href="${origin}`)
      expect(start, origin).toBeGreaterThan(-1)
      const tag = html.slice(start, html.indexOf(">", start))
      expect(tag).toContain('target="_blank"')
      expect(tag).toContain('rel="noopener noreferrer"')
    }
  })
  test("shows the whole paste, Copy, Replace, both warnings and the third-party note", () => {
    expect(html).toContain("Copy</button>")
    expect(html).toContain("&amp; I want help.")
    expect(html).toContain("Replace this link with a new one")
    expect(html.split(DO_NOT_FORWARD_NOTE).length - 1).toBe(2)
    expect(html).toContain(THIRD_PARTY_NOTE.replace("'", "&#x27;"))
    expect(COPIED_LINE).toBe("Copied. Press Ctrl+V, then Send")
  })
})
