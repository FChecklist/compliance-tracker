/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-12 (AW-604, AW-904): the hostnames the code accepts for inbound mail are the hostnames the DNS record list names.
// The list is ai-os/projexa-build-001/DNS_RESEND_INBOUND_RECORDS.md (the owner adds those MX records; nothing in this repository does).
// Before this test, the list proposed inbound.projexa-ai.com and inbound.veridian-aios.com while the code accepted only
// mail.veridian-aios.com, so a delivery to an inbound.* address could never find an alias.
//
// Run: bun test --isolate src/lib/services/email-inbound-hostnames.test.ts
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

process.env.DATABASE_URL ??= "postgresql://postgres:placeholder@localhost:5432/postgres"
process.env.APP_RUNTIME_DATABASE_URL ??= "postgresql://app_runtime:placeholder@localhost:5432/postgres"

import { ALLOWED_ALIAS_DOMAINS, DEFAULT_ALIAS_DOMAIN, INBOUND_ALIAS_DOMAINS, parseRecipientAddress } from "./email-alias-service"

const REPO_ROOT = new URL("../../../", import.meta.url)
const dnsList = readFileSync(new URL("ai-os/projexa-build-001/DNS_RESEND_INBOUND_RECORDS.md", REPO_ROOT), "utf8")

/** The hosts the record list asks for: each table row `| n | <domain> | MX | \`<host>\` (...) |` gives `<host>.<domain>`. */
function listedHosts(text: string): string[] {
  const hosts: string[] = []
  for (const line of text.split("\n")) {
    const cells = line.split("|").map((c) => c.trim())
    if (cells.length < 5 || !/^\d+$/.test(cells[1])) continue
    const domain = cells[2]
    const type = cells[3]
    const host = /^`([a-z0-9-]+)`/.exec(cells[4])?.[1]
    if (type === "MX" && host && /^[a-z0-9.-]+\.[a-z]+$/.test(domain)) hosts.push(`${host}.${domain}`)
  }
  return hosts
}

describe("AW-604: the inbound hostnames in the code and in the DNS record list are the same", () => {
  test("the record list asks for two hosts, and the code accepts both of them", () => {
    const hosts = listedHosts(dnsList)
    expect(hosts.sort()).toEqual(["inbound.projexa-ai.com", "inbound.veridian-aios.com"])
    for (const host of hosts) expect(ALLOWED_ALIAS_DOMAINS as readonly string[]).toContain(host)
  })

  test("the code accepts no inbound host that the list does not name, apart from the default mail host that already existed", () => {
    const hosts = listedHosts(dnsList)
    for (const domain of ALLOWED_ALIAS_DOMAINS) {
      if (domain === DEFAULT_ALIAS_DOMAIN) continue
      expect(hosts).toContain(domain)
    }
    expect([...INBOUND_ALIAS_DOMAINS].sort()).toEqual(hosts.sort())
  })

  test("a recipient on an inbound host parses to that host, so the alias lookup can match a row of that domain", () => {
    expect(parseRecipientAddress("Asha.Mehta@Inbound.Projexa-AI.com")).toEqual({ localPart: "asha.mehta", domain: "inbound.projexa-ai.com" })
    expect(parseRecipientAddress("asha@inbound.veridian-aios.com")).toEqual({ localPart: "asha", domain: "inbound.veridian-aios.com" })
  })

  test("no root domain is accepted: the root MX of veridian-aios.com stays with Google Workspace", () => {
    for (const domain of ALLOWED_ALIAS_DOMAINS) {
      expect(domain).not.toBe("veridian-aios.com")
      expect(domain).not.toBe("projexa-ai.com")
    }
  })
})
