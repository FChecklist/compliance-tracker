// VERIDIAN Review Framework remediation, Wave B: tests the pure assessment
// scoring functions (gradeAnswer / gradeSubmission) directly, matching this
// repo's established pattern of not exercising withTenantContext/a live DB
// from a .test.ts file (see hr-attendance-service.test.ts's own note on
// this, itself citing erp-fixed-assets-service.test.ts).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { gradeAnswer, gradeSubmission, type GradableQuestion } from "./training-service"

describe("gradeAnswer", () => {
  test("multiple_choice: correct option id matches", () => {
    const q: GradableQuestion = { id: "q1", questionType: "multiple_choice", correctAnswer: "1", points: 1 }
    expect(gradeAnswer(q, "1")).toBe(true)
    expect(gradeAnswer(q, "0")).toBe(false)
  })

  test("multiple_choice: missing answer never matches", () => {
    const q: GradableQuestion = { id: "q1", questionType: "multiple_choice", correctAnswer: "1", points: 1 }
    expect(gradeAnswer(q, undefined)).toBe(false)
  })

  test("true_false: string comparison against 'true'/'false' ids", () => {
    const q: GradableQuestion = { id: "q2", questionType: "true_false", correctAnswer: "true", points: 1 }
    expect(gradeAnswer(q, "true")).toBe(true)
    expect(gradeAnswer(q, "false")).toBe(false)
  })

  test("short_answer: case-insensitive, trimmed match against a single accepted answer", () => {
    const q: GradableQuestion = { id: "q3", questionType: "short_answer", correctAnswer: "Mumbai", points: 2 }
    expect(gradeAnswer(q, "  mumbai  ")).toBe(true)
    expect(gradeAnswer(q, "MUMBAI")).toBe(true)
    expect(gradeAnswer(q, "Delhi")).toBe(false)
  })

  test("short_answer: matches any of multiple accepted answers", () => {
    const q: GradableQuestion = { id: "q4", questionType: "short_answer", correctAnswer: ["GST", "Goods and Services Tax"], points: 2 }
    expect(gradeAnswer(q, "gst")).toBe(true)
    expect(gradeAnswer(q, "goods and services tax")).toBe(true)
    expect(gradeAnswer(q, "VAT")).toBe(false)
  })
})

describe("gradeSubmission", () => {
  const questions: GradableQuestion[] = [
    { id: "q1", questionType: "multiple_choice", correctAnswer: "1", points: 1 },
    { id: "q2", questionType: "true_false", correctAnswer: "true", points: 1 },
    { id: "q3", questionType: "short_answer", correctAnswer: "India", points: 2 },
  ]

  test("all correct: full score, passes a 70% threshold", () => {
    const result = gradeSubmission(questions, { q1: "1", q2: "true", q3: "india" }, 70)
    expect(result.score).toBe(4)
    expect(result.maxScore).toBe(4)
    expect(result.scorePercent).toBe(100)
    expect(result.passed).toBe(true)
  })

  test("partial credit computed correctly and threshold enforced", () => {
    // q1 correct (1pt), q2 wrong (0pt), q3 correct (2pt) = 3/4 = 75%
    const result = gradeSubmission(questions, { q1: "1", q2: "false", q3: "India" }, 70)
    expect(result.score).toBe(3)
    expect(result.scorePercent).toBe(75)
    expect(result.passed).toBe(true)
  })

  test("below threshold does not pass", () => {
    const result = gradeSubmission(questions, { q1: "0", q2: "false", q3: "wrong" }, 70)
    expect(result.score).toBe(0)
    expect(result.scorePercent).toBe(0)
    expect(result.passed).toBe(false)
  })

  test("exactly at threshold passes (>=, not >)", () => {
    // 1 question worth 1 point, correct -> 100%, threshold 100
    const result = gradeSubmission([{ id: "q1", questionType: "multiple_choice", correctAnswer: "a", points: 1 }], { q1: "a" }, 100)
    expect(result.passed).toBe(true)
  })

  test("empty question set never silently passes (0% against any positive threshold)", () => {
    const result = gradeSubmission([], {}, 70)
    expect(result.maxScore).toBe(0)
    expect(result.scorePercent).toBe(0)
    expect(result.passed).toBe(false)
  })

  test("empty question set against a 0% threshold does pass -- threshold is the caller's real gate, not this function's job to second-guess", () => {
    const result = gradeSubmission([], {}, 0)
    expect(result.passed).toBe(true)
  })
})
