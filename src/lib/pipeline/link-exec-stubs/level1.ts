// Stub of src/lib/pipeline/level1.ts for the ai-work-link-exec bundle: the Level 1 model lane. A link call never runs it (effectiveLevel1 returns
// "off" for a link). level1OffRunner is the one pure export and keeps its real behaviour.
import { thrower } from "./unavailable"
export const runLevel1 = thrower("the Level 1 model lane")
export const refusalAsUnresolved = thrower("level1 refusalAsUnresolved")
export const level1RefusalCode = thrower("level1 level1RefusalCode")
export function level1OffRunner() {
  return async (texts: string[]) => ({
    resolutions: texts.map(() => null),
    reasons: texts.map(() => "Level 1 is off for this caller"),
    modelCalls: 0,
  })
}
