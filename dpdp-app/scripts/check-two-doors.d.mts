// Types for check-two-doors.mjs (plain ESM so it runs under node).
import type { Facts } from "../src/lib/facts.mjs"

export interface WallHit {
  pattern: string
  snippet: string
}
export interface CssRule {
  selector: string
  body: string
  media: string | null
}
export interface HiddenTextHit {
  kind: string
  detail: string
}
export interface AiInstructionHit {
  pattern: string
  snippet: string
}
export interface SpellingVariant {
  variant: string
  index: number
}
export interface BrandLineDeviation {
  found: string
  expected: string
}

export const FORBIDDEN_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }>
export const PRAISE_PATTERNS: readonly RegExp[]
export const SHARE_ASK_PATTERN: RegExp
export const AI_SURFACES: readonly string[]
export const CORRECT_SPELLING: string
export const SPELLING_SCAN_EXEMPT: ReadonlyMap<string, string>

export function scanWall(text: string, opts?: { robots?: boolean }): WallHit[]
export function parseCss(css: string): CssRule[]
export function alwaysHiddenClasses(css: string): { hidden: Map<string, string[]>; complex: Array<{ selector: string; how: string[] }> }
export function findHiddenText(html: string, css: string): HiddenTextHit[]
export function findAiInstructions(text: string, opts?: { aiSurface?: boolean }): AiInstructionHit[]
export function findSpellingVariants(text: string): SpellingVariant[]
export function findBrandLineDeviations(text: string, brand: Facts["brand"]): BrandLineDeviation[]
export function sourceFiles(root?: string): string[]
export function publicSurfaceFiles(): string[]
