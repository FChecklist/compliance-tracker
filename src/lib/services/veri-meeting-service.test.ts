/// <reference types="bun-types" />
// R67 D-17 / D-21. veri-meeting-service.ts had NO sibling test at all (it was
// on docs/master/TEST_COVERAGE_GAP.md's untested list), which is why this file
// exists alongside the changes rather than after them -- CI's "New Test
// Coverage Check" gate requires it.
//
// Scope, matching this directory's established convention (see
// construction-boq-service.test.ts's own header): only the PURE helpers are
// exercised. Everything else in that service runs inside withTenantContext
// against a real Postgres transaction, which a unit test must not open.
//
// The two behaviours under test are the two the audit actually recorded as
// wrong:
//   D-17  Delete was ABSENT on a published meeting rather than disabled with
//         a reason, so the rule "only a draft can be deleted" existed nowhere
//         a reader could check it.
//   D-21  the share message named VERIDIAN to a PROJEXA customer and built
//         its URL from request.nextUrl.origin -- for a server-to-server call
//         that is VERIDIAN's own deployment host, never the product domain
//         the recipient has to open.
import { describe, expect, test } from "bun:test"
import {
  canDeleteMeeting,
  MEETING_DELETE_BLOCKED_REASON,
  MEETING_DELETED_STATUS,
  normaliseShareBrand,
  resolveShareOrigin,
  formatShareDate,
  composeMeetingShareTarget,
} from "./veri-meeting-service"

describe("canDeleteMeeting (D-17: the rule the disabled button states)", () => {
  test("a draft is deletable", () => {
    expect(canDeleteMeeting("draft")).toBe(true)
  })

  test("a published meeting is not -- it is the locked record publish/lock exists to protect", () => {
    expect(canDeleteMeeting("published")).toBe(false)
  })

  test("an already soft-deleted meeting is not deletable a second time", () => {
    expect(canDeleteMeeting(MEETING_DELETED_STATUS)).toBe(false)
  })

  test("the refusal sentence is the exact string the UI renders beside a disabled Delete", () => {
    // If these two ever drift, the user reads one reason and the server gives
    // another. Pinned here on purpose.
    expect(MEETING_DELETE_BLOCKED_REASON).toBe("Published meetings cannot be deleted")
  })
})

describe("resolveShareOrigin (D-21: never the request's own origin when a real one was passed)", () => {
  const FALLBACK = "https://veridian-compliance-ai.vercel.app"

  test("a valid absolute origin wins over the request origin", () => {
    expect(resolveShareOrigin("https://projexa-ai.com", FALLBACK)).toBe("https://projexa-ai.com")
  })

  test("a path/query on the supplied value is stripped to the origin", () => {
    expect(resolveShareOrigin("https://projexa-ai.com/some/path?x=1", FALLBACK)).toBe("https://projexa-ai.com")
  })

  test("a localhost origin with a port is preserved, so local runs share a link that actually opens", () => {
    expect(resolveShareOrigin("http://localhost:3100", FALLBACK)).toBe("http://localhost:3100")
  })

  test("an empty, blank, non-URL or non-http value falls back instead of throwing", () => {
    for (const bad of ["", "   ", "projexa-ai.com", "javascript:alert(1)", "file:///etc/passwd", null, undefined, 42]) {
      expect(resolveShareOrigin(bad, FALLBACK)).toBe(FALLBACK)
    }
  })
})

describe("normaliseShareBrand", () => {
  test("only the literal 'projexa' selects the PROJEXA brand", () => {
    expect(normaliseShareBrand("projexa")).toBe("projexa")
  })

  test("anything else -- including a missing body -- stays on the pre-D-21 VERIDIAN wording", () => {
    for (const value of [undefined, null, "", "VERIDIAN", "Projexa", 1, {}]) {
      expect(normaliseShareBrand(value)).toBe("veridian")
    }
  })
})

describe("formatShareDate", () => {
  test("renders in the requested locale, pinned to UTC so the same instant never reads as two dates", () => {
    expect(formatShareDate("2026-08-28T18:30:00.000Z", "en-GB")).toBe("28 Aug 2026")
  })

  test("accepts a Date as well as an ISO string", () => {
    expect(formatShareDate(new Date("2026-08-28T00:00:00.000Z"), "en-GB")).toBe("28 Aug 2026")
  })

  test("an unparseable date yields an empty string rather than 'Invalid Date' in a WhatsApp message", () => {
    expect(formatShareDate("not a date")).toBe("")
  })
})

describe("composeMeetingShareTarget (D-21 acceptance)", () => {
  const BASE = {
    token: "tok_abc123",
    title: "Weekly Site Coordination - Villa 21",
    scheduledAt: "2026-08-28T09:00:00.000Z",
    projectName: "Villa 21",
    fallbackOrigin: "https://veridian-compliance-ai.vercel.app",
  }

  test("the PROJEXA message starts with 'Minutes of Meeting - ' and the URL origin is the PASSED shareOrigin, never the request origin", () => {
    const shareOrigin = "https://projexa-ai.com"
    const result = composeMeetingShareTarget({ ...BASE, brand: "projexa", shareOrigin })

    expect(result.message.startsWith("Minutes of Meeting - ")).toBe(true)
    expect(new URL(result.shareUrl).origin).toBe(shareOrigin)
    expect(result.shareUrl).not.toContain("veridian-compliance-ai.vercel.app")
    expect(result.message).not.toContain("veridian-compliance-ai.vercel.app")
  })

  test("the whole PROJEXA sentence is title, date, project, link -- in that order", () => {
    const result = composeMeetingShareTarget({ ...BASE, brand: "projexa", shareOrigin: "https://projexa-ai.com" })
    expect(result.message).toBe(
      "Minutes of Meeting - Weekly Site Coordination - Villa 21, 28 Aug 2026, Villa 21: https://projexa-ai.com/shared/mom/tok_abc123"
    )
  })

  test("a meeting with no project drops the project clause rather than printing a placeholder", () => {
    const result = composeMeetingShareTarget({ ...BASE, projectName: null, brand: "projexa", shareOrigin: "https://projexa-ai.com" })
    expect(result.message).toBe(
      "Minutes of Meeting - Weekly Site Coordination - Villa 21, 28 Aug 2026: https://projexa-ai.com/shared/mom/tok_abc123"
    )
  })

  test("the PROJEXA link points at PROJEXA's public page, not VERIDIAN's /shared/meeting", () => {
    const result = composeMeetingShareTarget({ ...BASE, brand: "projexa", shareOrigin: "https://projexa-ai.com" })
    expect(new URL(result.shareUrl).pathname).toBe("/shared/mom/tok_abc123")
  })

  test("the WhatsApp href carries the composed sentence, url-encoded", () => {
    const result = composeMeetingShareTarget({ ...BASE, brand: "projexa", shareOrigin: "https://projexa-ai.com" })
    expect(result.whatsappHref).toBe(`https://wa.me/?text=${encodeURIComponent(result.message)}`)
  })

  test("a caller that sends no brand and no origin is byte-identical to the pre-D-21 behaviour", () => {
    const result = composeMeetingShareTarget(BASE)
    expect(result.brand).toBe("veridian")
    expect(result.shareUrl).toBe("https://veridian-compliance-ai.vercel.app/shared/meeting/tok_abc123")
    expect(result.message).toBe(
      "View these VERIDIAN AI meeting minutes: https://veridian-compliance-ai.vercel.app/shared/meeting/tok_abc123"
    )
  })

  test("a token with URL-unsafe characters is encoded into the path", () => {
    const result = composeMeetingShareTarget({ ...BASE, token: "a b/c", brand: "projexa", shareOrigin: "https://projexa-ai.com" })
    expect(result.shareUrl).toBe("https://projexa-ai.com/shared/mom/a%20b%2Fc")
  })
})
