// AI Cost Governance & FinOps gap-closure (2026-07-18): "Forecasted AI
// spend vs actual tracked monthly" -- per the task's own recommended
// approach ("simple linear run-rate projection first, refine only if
// inaccurate in practice"), this is deliberately the cheapest honest
// forecast: (spend so far this month / days elapsed) * days in month. No
// seasonality, no day-of-week weighting -- those are real refinements to
// make later if this proves inaccurate in practice, not built speculatively
// now. Pure/DB-free so both cost-guard.ts (per-org, surfaced in
// OrgLimitsSection.tsx) and token-usage-service.ts (platform-wide, Finance
// report) can reuse the identical calculation rather than each
// re-deriving it slightly differently.
export function daysInMonthUtc(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
}

export function startOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

/** Pure: whole + partial days elapsed since the start of the month, minimum 1 so a same-day forecast doesn't divide by zero. */
export function daysElapsedInMonthUtc(now: Date): number {
  const start = startOfMonthUtc(now)
  const elapsedMs = now.getTime() - start.getTime()
  return Math.max(1, elapsedMs / 86_400_000)
}

export type SpendForecast = {
  periodStart: string
  now: string
  daysElapsed: number
  daysInMonth: number
  actualSpendToDateUsd: number
  forecastedMonthEndSpendUsd: number
}

/** Pure: linear run-rate projection. Zero spend so far forecasts to zero, not NaN. */
export function computeLinearForecast(actualSpendToDateUsd: number, daysElapsed: number, daysInMonth: number): number {
  if (daysElapsed <= 0) return 0
  return (actualSpendToDateUsd / daysElapsed) * daysInMonth
}

export function buildSpendForecast(actualSpendToDateUsd: number, now: Date): SpendForecast {
  const daysElapsed = daysElapsedInMonthUtc(now)
  const daysInMonth = daysInMonthUtc(now)
  return {
    periodStart: startOfMonthUtc(now).toISOString(),
    now: now.toISOString(),
    daysElapsed,
    daysInMonth,
    actualSpendToDateUsd,
    forecastedMonthEndSpendUsd: computeLinearForecast(actualSpendToDateUsd, daysElapsed, daysInMonth),
  }
}
