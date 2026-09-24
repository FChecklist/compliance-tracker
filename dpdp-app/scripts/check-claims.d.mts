// Types for check-claims.mjs (plain ESM so it runs under node).
import type { ClaimsRegister } from "../src/lib/facts.mjs"

export interface Surface {
  file: string
  texts: string[]
  missing?: boolean
}
export interface Violation {
  file: string
  word: string
  sentence: string
}

export function bannedWordRegex(word: string): RegExp
export function splitSentences(line: string): string[]
export function normalise(s: string): string
export function htmlTexts(html: string): string[]
export function fileTexts(name: string, body: string): string[]
export function surfaceFiles(): string[]
export function findViolations(surfaces: readonly Surface[], register: ClaimsRegister): Violation[]
export function readSurfaces(dist: string): Surface[]
