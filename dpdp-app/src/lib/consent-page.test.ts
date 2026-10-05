/// <reference types="bun-types" />
// The consent page (/p/): when it stays the original Yes/No page, when it becomes the fuller one, what has to be filled, and what can be withdrawn --
// plus the mock database's behaviour for the new RPCs (the real ones are proved in src/lib/services/dpdp-consent-page.pglite.test.ts, drizzle/0701).
import { describe, expect, test } from "bun:test"
import { answersToSend, answerWords, canSave, guardianProblem, isSimpleConsent, purposesOf, unanswered, withdrawable } from "./consent-page"
import { createMockClient, MOCK_TOKENS } from "./mock-client"
import { parentConsent, parentConsentAnswers, previewParentConsent, withdrawConsent } from "./api"
import type { ParentConsentPreview } from "./rpc-types"

type Ok = Extract<ParentConsentPreview, { ok: true }>
const base: Ok = { ok: true, orgName: "Sunrise", notice: { docKind: "privacy", version: "1.0", languages: ["en"] }, openedAt: null, actedAt: null, alreadyAnswered: false }
const multi: Ok = { ...base, purposes: [{ key: "trip", label: "Trip photos", answer: null }, { key: "news", label: "Newsletter", answer: null }], principalIsChild: false }
const child: Ok = { ...base, purposes: [{ key: "photos", label: "Photos", answer: null }], principalIsChild: true }

describe("which page", () => {
  test("a link with no purposes (a database without 0701, or an old campaign) is the original simple page", () => {
    expect(isSimpleConsent(base)).toBe(true)
    expect(purposesOf(base)).toHaveLength(1)
    expect(isSimpleConsent({ ...base, purposes: [{ key: "consent", label: "x", answer: null }], principalIsChild: false })).toBe(true)
  })
  test("several items, or a child, is the fuller page", () => {
    expect(isSimpleConsent(multi)).toBe(false)
    expect(isSimpleConsent(child)).toBe(false)
    expect(isSimpleConsent({ ...base, purposes: [{ key: "consent", label: "x", answer: null }], principalIsChild: true })).toBe(false)
  })
})

describe("what must be filled before saving", () => {
  test("every item needs a Yes or a No", () => {
    expect(unanswered(multi.purposes!, { trip: "yes" })).toEqual(["news"])
    expect(canSave(multi, { trip: "yes" }, { name: "", relation: "" })).toBe(false)
    expect(canSave(multi, { trip: "yes", news: "no" }, { name: "", relation: "" })).toBe(true)
  })
  test("a child needs the guardian's name and relationship as well", () => {
    const answers = { photos: "yes" as const }
    expect(canSave(child, answers, { name: "", relation: "" })).toBe(false)
    expect(guardianProblem(true, { name: "A", relation: "parent" })).toMatch(/name of the parent or legal guardian/)
    expect(guardianProblem(true, { name: "Meera Rao", relation: "" })).toMatch(/parent or the legal guardian/)
    expect(canSave(child, answers, { name: "Meera Rao", relation: "parent" })).toBe(true)
    expect(canSave(child, answers, { name: "मीरा राव", relation: "legal_guardian" })).toBe(true)
    expect(guardianProblem(false, { name: "", relation: "" })).toBeNull()
  })
  test("only Yes/No answers are sent, one per item", () => {
    expect(answersToSend(multi.purposes!, { trip: "yes", news: "no" })).toEqual({ trip: "yes", news: "no" })
    expect(answersToSend(multi.purposes!, { trip: "yes" })).toEqual({ trip: "yes" })
  })
})

describe("withdraw", () => {
  test("only an item answered Yes can be withdrawn; the words say what happened", () => {
    const answered: Ok = { ...multi, alreadyAnswered: true, purposes: [{ key: "trip", label: "Trip photos", answer: "yes" }, { key: "news", label: "Newsletter", answer: "no" }, { key: "x", label: "X", answer: "withdrawn" }] }
    expect(withdrawable(answered).map((p) => p.key)).toEqual(["trip"])
    expect([answerWords("yes"), answerWords("no"), answerWords("withdrawn"), answerWords(null)]).toEqual(["You said Yes", "You said No", "You said Yes, then withdrew it", "Not answered"])
  })
})

describe("the mock database: the same behaviour as drizzle/0701", () => {
  test("the original link still takes one Yes/No, shows it, and a Yes can be withdrawn with the same link", async () => {
    const client = createMockClient()
    const p0 = await previewParentConsent(client, MOCK_TOKENS.parent) as Ok
    expect(isSimpleConsent(p0)).toBe(true)
    expect(await parentConsent(client, MOCK_TOKENS.parent, "yes")).toEqual({ ok: true, answer: "yes" })
    const p1 = await previewParentConsent(client, MOCK_TOKENS.parent) as Ok
    expect(withdrawable(p1).map((p) => p.key)).toEqual(["consent"])
    expect(await withdrawConsent(client, MOCK_TOKENS.parent, "consent")).toEqual({ ok: true, withdrawn: "consent" })
    expect(purposesOf(await previewParentConsent(client, MOCK_TOKENS.parent) as Ok)[0].answer).toBe("withdrawn")
    expect((await withdrawConsent(client, MOCK_TOKENS.parent, "consent") as { reason: string }).reason).toMatch(/nothing to withdraw/)
  })
  test("a No on the original link cannot be withdrawn and shows no way to", async () => {
    const client = createMockClient()
    await parentConsent(client, MOCK_TOKENS.parent, "no")
    expect(withdrawable(await previewParentConsent(client, MOCK_TOKENS.parent) as Ok)).toEqual([])
  })
  test("the multi-item link: needs every answer, records them once, then withdraws one", async () => {
    const client = createMockClient()
    const p = await previewParentConsent(client, MOCK_TOKENS.parentMulti) as Ok
    expect(p.noticeText).toContain("trip photos")
    expect(isSimpleConsent(p)).toBe(false)
    expect((await parentConsentAnswers(client, MOCK_TOKENS.parentMulti, { trip: "yes" }, null) as { reason: string }).reason).toMatch(/each item/)
    expect(await parentConsentAnswers(client, MOCK_TOKENS.parentMulti, { trip: "yes", news: "no" }, null)).toEqual({ ok: true, recorded: 2 })
    expect((await parentConsentAnswers(client, MOCK_TOKENS.parentMulti, { trip: "no", news: "no" }, null) as { reason: string }).reason).toMatch(/already been used/)
    expect(await withdrawConsent(client, MOCK_TOKENS.parentMulti, "trip")).toEqual({ ok: true, withdrawn: "trip" })
    expect((await previewParentConsent(client, MOCK_TOKENS.parentMulti) as Ok).purposes!.map((x) => x.answer)).toEqual(["withdrawn", "no"])
  })
  test("the child link needs the guardian", async () => {
    const client = createMockClient()
    expect((await parentConsentAnswers(client, MOCK_TOKENS.parentChild, { photos: "yes" }, null) as { reason: string }).reason).toMatch(/name of the parent or legal guardian/)
    expect((await parentConsentAnswers(client, MOCK_TOKENS.parentChild, { photos: "yes" }, { name: "Meera Rao", relation: "parent" })).ok).toBe(true)
    expect((await previewParentConsent(client, MOCK_TOKENS.parentChild) as Ok).guardian).toEqual({ name: "Meera Rao", relation: "parent" })
  })
})
