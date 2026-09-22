export const CRAWLER_AGENTS: ReadonlyArray<readonly [name: string, userAgent: string]>
export const PUBLIC_PATHS: readonly string[]
export const PRIVATE_PATHS: readonly string[]

export type CrawlerProbeRow = {
  agent: string
  path: string
  kind: "public" | "private"
  status: number
  xRobots: string | null
  ok: boolean
}
export type CrawlerCheckResult = { ok: boolean; any403: boolean; rows: CrawlerProbeRow[] }

export function checkCrawlerAccess(
  baseUrl: string,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<CrawlerCheckResult>
export function formatTable(rows: CrawlerProbeRow[]): string
