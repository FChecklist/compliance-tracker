// VERIDIAN Review Framework gap-closure (task-20260718-083002): "Business
// Rule & Validation Accuracy" finding on VERI Reward -- achievement unlock
// logic (checkAndUnlockAchievements) compares progressValue against
// targetValue, but with 0 unlocks ever recorded live, the correctness of
// that comparison was unverified. Tests the pure predicate
// evaluateAchievementProgress() rather than the DB-backed function directly,
// matching this repo's own established pattern of not touching a live DB
// from a .test.ts file (see crm-service.test.ts's own header note).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { evaluateAchievementProgress } from "./veri-reward-service"

describe("evaluateAchievementProgress -- achievement unlock threshold business rule", () => {
  test("fresh progress below target -- increments, does not unlock", () => {
    const result = evaluateAchievementProgress({
      currentProgress: 0,
      alreadyUnlocked: false,
      incrementBy: 1,
      targetValue: 5,
    })
    expect(result).toEqual({ newProgress: 1, justUnlocked: false })
  })

  test("exact threshold crossing -- unlocks on the call that reaches targetValue", () => {
    const result = evaluateAchievementProgress({
      currentProgress: 4,
      alreadyUnlocked: false,
      incrementBy: 1,
      targetValue: 5,
    })
    expect(result).toEqual({ newProgress: 5, justUnlocked: true })
  })

  test("overshoot in one increment (incrementBy > 1) still unlocks", () => {
    const result = evaluateAchievementProgress({
      currentProgress: 2,
      alreadyUnlocked: false,
      incrementBy: 10,
      targetValue: 5,
    })
    expect(result).toEqual({ newProgress: 12, justUnlocked: true })
  })

  test("already unlocked -- keeps incrementing progress but never re-unlocks", () => {
    const result = evaluateAchievementProgress({
      currentProgress: 5,
      alreadyUnlocked: true,
      incrementBy: 1,
      targetValue: 5,
    })
    expect(result).toEqual({ newProgress: 6, justUnlocked: false })
  })

  test("already unlocked, incrementBy 0 (e.g. a re-display call) -- stable, still not re-unlocked", () => {
    const result = evaluateAchievementProgress({
      currentProgress: 5,
      alreadyUnlocked: true,
      incrementBy: 0,
      targetValue: 5,
    })
    expect(result).toEqual({ newProgress: 5, justUnlocked: false })
  })

  test("targetValue of 1 (single-event achievement) unlocks on first increment", () => {
    const result = evaluateAchievementProgress({
      currentProgress: 0,
      alreadyUnlocked: false,
      incrementBy: 1,
      targetValue: 1,
    })
    expect(result).toEqual({ newProgress: 1, justUnlocked: true })
  })

  test("one call short of the target never unlocks", () => {
    const result = evaluateAchievementProgress({
      currentProgress: 0,
      alreadyUnlocked: false,
      incrementBy: 4,
      targetValue: 5,
    })
    expect(result).toEqual({ newProgress: 4, justUnlocked: false })
  })
})
