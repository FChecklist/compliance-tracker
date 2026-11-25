/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MONEYPENNY_PRODUCT_ID, MoneypennyChatMount } from "./MoneypennyChatMount"

describe("MoneypennyChatMount", () => {
  test("the product id is veridian-aios-dpdp", () => {
    expect(MONEYPENNY_PRODUCT_ID).toBe("veridian-aios-dpdp")
  })

  test("renders nothing yet", () => {
    expect(renderToStaticMarkup(createElement(MoneypennyChatMount, { productId: MONEYPENNY_PRODUCT_ID }))).toBe("")
  })

  test("is mounted once in App.tsx, which wraps every Partner and client screen", () => {
    const app = readFileSync(join(resolve(import.meta.dir, "../.."), "src/App.tsx"), "utf8")
    expect(app).toContain("<MoneypennyChatMount productId={MONEYPENNY_PRODUCT_ID} />")
  })
})
