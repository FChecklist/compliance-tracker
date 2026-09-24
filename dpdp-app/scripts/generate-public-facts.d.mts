// Types for generate-public-facts.mjs (plain ESM so it runs under node).
import type { Facts } from "../src/lib/facts.mjs"

export function esc(s: unknown): string
export function decodeEntities(s: string): string
export function visibleLines(html: string, opts?: { keepBrandLine?: boolean; keepNav?: boolean }): string[]
export function applyToLanding(facts: Facts, html: string, path: string, file: string): string
export function buildOutputs(): { facts: Facts; files: Map<string, string> }
