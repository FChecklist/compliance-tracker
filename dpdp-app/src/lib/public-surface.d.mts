// Types for public-surface.mjs (see that file's header for why it is plain
// ESM). Keep the two in step by hand -- there is no generator.

export interface PublicPage {
  readonly path: string
  readonly source: string
  readonly title: string
  readonly h1: string
  readonly jsonLd: readonly string[]
  readonly mustContain: readonly string[]
}

export interface PrivatePage {
  readonly prefix: string
  readonly source: string
}

export interface RobotsGroup {
  agents: string[]
  allow: string[]
  disallow: string[]
}

export interface HeaderRule {
  path: string
  set: [string, string][]
  unset: string[]
}

export declare const SITE_ORIGIN: string
export declare const REQUIRED_BOTS: readonly string[]
export declare const PRIVATE_PAGES: readonly PrivatePage[]
export declare const PUBLIC_PAGES: readonly PublicPage[]
export declare function pageUrl(path: string): string
export declare function isW3cDatetime(s: string): boolean
export declare function renderSitemap(entries: ReadonlyArray<{ path: string; lastmod: string }>): string
export declare function parseRobots(text: string): { groups: RobotsGroup[]; sitemaps: string[] }
export declare function parseHeadersFile(text: string): HeaderRule[]
export declare function resolveHeaders(rules: readonly HeaderRule[], path: string): Record<string, string>
