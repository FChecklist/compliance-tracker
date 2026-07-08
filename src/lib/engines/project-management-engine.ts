// VCEL Project Management Engine. burndown_calculator has a PMS module (tasks/sprints) but no confirmed chart calc.
import Decimal from "decimal.js"

export type PmTask = { id: string; duration: number; dependsOn: string[] }

// 1. Critical Path Engine -- classic CPM forward/backward pass over a task DAG
export function calculateCriticalPath(tasks: PmTask[]): { taskId: string; earlyStart: number; earlyFinish: number; lateStart: number; lateFinish: number; slack: number; isCritical: boolean }[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const earlyStart = new Map<string, number>()
  const earlyFinish = new Map<string, number>()

  const visited = new Set<string>()
  function computeEarly(id: string): number {
    if (earlyFinish.has(id)) return earlyFinish.get(id)!
    if (visited.has(id)) throw new Error(`cycle detected involving task ${id}`)
    visited.add(id)
    const task = byId.get(id)
    if (!task) throw new Error(`unknown task dependency: ${id}`)
    const es = task.dependsOn.length ? Math.max(...task.dependsOn.map(computeEarly)) : 0
    const ef = es + task.duration
    earlyStart.set(id, es); earlyFinish.set(id, ef)
    visited.delete(id)
    return ef
  }
  for (const t of tasks) computeEarly(t.id)

  const projectDuration = Math.max(...Array.from(earlyFinish.values()))
  const successors = new Map<string, string[]>()
  for (const t of tasks) for (const dep of t.dependsOn) successors.set(dep, [...(successors.get(dep) ?? []), t.id])

  const lateFinish = new Map<string, number>()
  const lateStart = new Map<string, number>()
  function computeLate(id: string): number {
    if (lateStart.has(id)) return lateStart.get(id)!
    const task = byId.get(id)!
    const succs = successors.get(id) ?? []
    const lf = succs.length ? Math.min(...succs.map(computeLate)) : projectDuration
    const ls = lf - task.duration
    lateFinish.set(id, lf); lateStart.set(id, ls)
    return ls
  }
  for (const t of tasks) computeLate(t.id)

  return tasks.map((t) => {
    const slack = lateStart.get(t.id)! - earlyStart.get(t.id)!
    return { taskId: t.id, earlyStart: earlyStart.get(t.id)!, earlyFinish: earlyFinish.get(t.id)!, lateStart: lateStart.get(t.id)!, lateFinish: lateFinish.get(t.id)!, slack, isCritical: slack === 0 }
  })
}

// 2. Resource Allocation Engine -- greedy allocation of resource capacity across tasks by priority
export function allocateResources(tasks: { id: string; requiredCapacity: number; priority: number }[], availableCapacity: number): { allocated: string[]; unallocated: string[] } {
  const sorted = [...tasks].sort((a, b) => b.priority - a.priority)
  let remaining = availableCapacity
  const allocated: string[] = []
  const unallocated: string[] = []
  for (const t of sorted) {
    if (t.requiredCapacity <= remaining) { allocated.push(t.id); remaining -= t.requiredCapacity } else unallocated.push(t.id)
  }
  return { allocated, unallocated }
}

// 3. Cost Variance Engine (EVM: CV = EV - AC)
export function calculateCostVariance(earnedValue: number, actualCost: number): number { return round2(new Decimal(earnedValue).minus(actualCost)) }

// 4. Schedule Variance Engine (EVM: SV = EV - PV)
export function calculateScheduleVariance(earnedValue: number, plannedValue: number): number { return round2(new Decimal(earnedValue).minus(plannedValue)) }

// 5. Earned Value Calculator -- full EVM metric set (CPI, SPI, EAC)
export function calculateEarnedValueMetrics(input: { plannedValue: number; earnedValue: number; actualCost: number; budgetAtCompletion: number }): { cv: number; sv: number; cpi: number; spi: number; eac: number } {
  const cv = new Decimal(input.earnedValue).minus(input.actualCost)
  const sv = new Decimal(input.earnedValue).minus(input.plannedValue)
  const cpi = input.actualCost !== 0 ? new Decimal(input.earnedValue).div(input.actualCost) : new Decimal(0)
  const spi = input.plannedValue !== 0 ? new Decimal(input.earnedValue).div(input.plannedValue) : new Decimal(0)
  const eac = cpi.gt(0) ? new Decimal(input.budgetAtCompletion).div(cpi) : new Decimal(input.budgetAtCompletion)
  return { cv: round2(cv), sv: round2(sv), cpi: round2(cpi), spi: round2(spi), eac: round2(eac) }
}

// 6. Burndown Calculator -- ideal vs actual remaining-work trend over sprint days
export function calculateBurndown(totalStoryPoints: number, sprintDays: number, completedPointsByDay: number[]): { day: number; idealRemaining: number; actualRemaining: number }[] {
  const idealPerDay = totalStoryPoints / sprintDays
  let completedCumulative = 0
  return Array.from({ length: sprintDays }, (_, i) => {
    completedCumulative += completedPointsByDay[i] ?? 0
    return { day: i + 1, idealRemaining: round2(new Decimal(totalStoryPoints).minus(idealPerDay * (i + 1))), actualRemaining: round2(new Decimal(totalStoryPoints).minus(completedCumulative)) }
  })
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
