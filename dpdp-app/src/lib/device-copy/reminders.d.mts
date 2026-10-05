export const SOON_DAYS: number
export type StoredPageLike = { viewer?: { kind?: string }; rows?: Array<Record<string, unknown>> } & Record<string, unknown>
export type DueCounts = { overdue: number; soon: number }
export function dayKey(d: Date): string
export function mineAndOpen(page: StoredPageLike | null | undefined, email: string): Array<Record<string, unknown>>
export function countDue(page: StoredPageLike | null | undefined, email: string, now: Date): DueCounts
export function reminderText(counts: DueCounts): { title: string; body: string } | null
export function decideReminder(args: { page: StoredPageLike | null | undefined; email: string; now: Date; lastDay?: string | null; force?: boolean }):
  { show: false; day: string; counts: DueCounts } | { show: true; day: string; counts: DueCounts; title: string; body: string }
