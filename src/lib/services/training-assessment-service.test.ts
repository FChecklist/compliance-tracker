// VERIDIAN Review Framework remediation, Wave B: tests the pure Training/LMS
// assessment-scoring functions (scoreQuestion / scoreAttempt /
// determinePassed / assertRetakeAllowed) directly, matching this repo's
// established pattern of not exercising withTenantContext/a live DB from a
// .test.ts file (see hr-attendance-service.test.ts's own note on this).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { scoreQuestion, scoreAttempt, determinePassed, assertRetakeAllowed, ServiceError, type QuestionLike } from "./training-assessment-service"

describe("scoreQuestion", () => {
  test("multiple_choice: single correct index matches exactly", () => {
    const q: QuestionLike = { id: "q1", questionType: "multiple_choice", correctAnswer: 1, points: 1 }
    expect(scoreQuestion(q, 1)).toBe(true)
    expect(scoreQuestion(q, 0)).toBe(false)
  })
  test("multiple_choice: multi-select is order-insensitive", () => {
    const q: QuestionLike = { id: "q2", questionType: "multiple_choice", correctAnswer: [0, 2], points: 2 }
    expect(scoreQuestion(q, [2, 0])).toBe(true)
    expect(scoreQuestion(q, [0])).toBe(false)
    expect(scoreQuestion(q, [0, 1])).toBe(false)
  })
  test("true_false: coerces truthy/falsy correctly", () => {
    const q: QuestionLike = { id: "q3", questionType: "true_false", correctAnswer: true, points: 1 }
    expect(scoreQuestion(q, true)).toBe(true)
    expect(scoreQuestion(q, false)).toBe(false)
  })
  test("short_answer: case-insensitive, trimmed match", () => {
    const q: QuestionLike = { id: "q4", questionType: "short_answer", correctAnswer: "GDPR", points: 1 }
    expect(scoreQuestion(q, "  gdpr  ")).toBe(true)
    expect(scoreQuestion(q, "gdpr compliance")).toBe(false)
  })
  test("an undefined/null submission is always wrong, never throws", () => {
    const q: QuestionLike = { id: "q5", questionType: "multiple_choice", correctAnswer: 0, points: 1 }
    expect(scoreQuestion(q, undefined)).toBe(false)
    expect(scoreQuestion(q, null)).toBe(false)
  })
})

describe("scoreAttempt", () => {
  test("sums points for correct answers only, computes percent", () => {
    const questions: QuestionLike[] = [
      { id: "a", questionType: "multiple_choice", correctAnswer: 0, points: 1 },
      { id: "b", questionType: "true_false", correctAnswer: true, points: 1 },
      { id: "c", questionType: "short_answer", correctAnswer: "yes", points: 2 },
    ]
    const result = scoreAttempt(questions, { a: 0, b: false, c: "yes" })
    expect(result.score).toBe(3) // a (1) + c (2), b wrong
    expect(result.maxScore).toBe(4)
    expect(result.scorePercent).toBe(75)
  })
  test("zero questions produces zero maxScore and zero percent, not NaN/Infinity", () => {
    const result = scoreAttempt([], {})
    expect(result.maxScore).toBe(0)
    expect(result.scorePercent).toBe(0)
  })
})

describe("determinePassed", () => {
  test("meets-or-exceeds threshold passes", () => {
    expect(determinePassed(70, 70)).toBe(true)
    expect(determinePassed(69.99, 70)).toBe(false)
    expect(determinePassed(100, 70)).toBe(true)
  })
})

describe("assertRetakeAllowed", () => {
  test("null maxAttempts means unlimited retakes", () => {
    expect(() => assertRetakeAllowed(50, null)).not.toThrow()
  })
  test("throws once prior attempts reach the cap", () => {
    expect(() => assertRetakeAllowed(3, 3)).toThrow(ServiceError)
    expect(() => assertRetakeAllowed(2, 3)).not.toThrow()
  })
})
