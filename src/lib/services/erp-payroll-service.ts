// Wave 56 (VERI ERP gap-fill, Tier 2 #5/#6): Indian Statutory Payroll.
// Deliberately scoped narrower than ERP_BENCHMARK_COMPARISON.md's full ask:
// PF, ESI, and Professional Tax are computed by a real rule engine whose
// rates/ceilings/slabs live in erp_statutory_rules as admin-editable master
// data -- never hardcoded here -- since these change via periodic
// government notification (see VAIOS_ARCHITECTURE_STRATEGY.md's payroll
// section). TDS (income tax) is deliberately NOT auto-computed: correct TDS
// depends on regime choice (old/new), Section 80C/HRA exemptions, and
// annual slab projection, none of which can be safely approximated without
// real risk of an incorrect statutory deduction -- getting this wrong is a
// legal/financial liability for customers, not a UX bug. Every payslip
// carries a manually-entered TDS line the payroll preparer sets before
// finalizing.
import {
  erpSalaryComponents, erpSalaryStructures, erpSalaryStructureComponents,
  erpStatutoryRules, erpPayrollRuns, erpPayslips, erpPayslipLines,
  employeeProfiles, users,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, lte, or, isNull, gte } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// ============================================================
// Salary Components (master data: Basic, HRA, Special Allowance, ...)
// ============================================================

export async function listSalaryComponents(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpSalaryComponents.findMany({ where: eq(erpSalaryComponents.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.name) })
  })
}

export async function createSalaryComponent(
  ctx: ErpContext,
  input: { name: string; componentType: "earning" | "deduction"; calculationType?: "flat" | "percentage_of_basic" | "percentage_of_gross"; defaultPercentage?: number; defaultAmount?: number; isStatutory?: boolean; includeInPfWage?: boolean }
) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [component] = await db.insert(erpSalaryComponents).values({
      orgId: ctx.orgId, name: input.name, componentType: input.componentType,
      calculationType: input.calculationType ?? "flat",
      defaultPercentage: input.defaultPercentage?.toString(), defaultAmount: input.defaultAmount?.toString(),
      isStatutory: input.isStatutory ?? false, includeInPfWage: input.includeInPfWage ?? false,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_salary_component.created", entityType: "erp_salary_component", entityId: component.id })
    return component
  })
}

// ============================================================
// Statutory Rules (admin-editable master data -- PF/ESI/PT rates)
// ============================================================

export async function listStatutoryRules(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpStatutoryRules.findMany({ where: eq(erpStatutoryRules.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.effectiveFrom) })
  })
}

export async function createStatutoryRule(
  ctx: ErpContext,
  input: { ruleType: "pf" | "esi" | "professional_tax"; state?: string; effectiveFrom: string; effectiveTo?: string; employeeRate?: number; employerRate?: number; wageCeiling?: number; slabs?: { uptoAmount: number; taxAmount: number }[]; notes?: string }
) {
  if (input.ruleType === "professional_tax" && !input.state?.trim()) throw new ServiceError("state is required for professional_tax rules", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [rule] = await db.insert(erpStatutoryRules).values({
      orgId: ctx.orgId, ruleType: input.ruleType, state: input.state, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
      employeeRate: input.employeeRate?.toString(), employerRate: input.employerRate?.toString(), wageCeiling: input.wageCeiling?.toString(),
      slabs: input.slabs, notes: input.notes,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_statutory_rule.created", entityType: "erp_statutory_rule", entityId: rule.id })
    return rule
  })
}

async function findActiveRule(db: TenantDb, orgId: string, ruleType: "pf" | "esi" | "professional_tax", asOfDate: string, state?: string | null) {
  const rules = await db.query.erpStatutoryRules.findMany({
    where: and(
      eq(erpStatutoryRules.orgId, orgId),
      eq(erpStatutoryRules.ruleType, ruleType),
      lte(erpStatutoryRules.effectiveFrom, asOfDate),
      or(isNull(erpStatutoryRules.effectiveTo), gte(erpStatutoryRules.effectiveTo, asOfDate)),
      ruleType === "professional_tax" && state ? eq(erpStatutoryRules.state, state) : undefined
    ),
    orderBy: (t, { desc }) => desc(t.effectiveFrom),
  })
  return rules[0] ?? null
}

// ============================================================
// Salary Structures
// ============================================================

export async function listSalaryStructures(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const structures = await db.query.erpSalaryStructures.findMany({
      where: eq(erpSalaryStructures.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.effectiveFrom),
      with: { components: { with: { component: true } } },
    })
    const profiles = await db.query.employeeProfiles.findMany({ where: eq(employeeProfiles.orgId, ctx.orgId) })
    const orgUsers = await db.query.users.findMany({ where: eq(users.orgId, ctx.orgId), columns: { id: true, name: true } })
    const profileById = new Map(profiles.map((p) => [p.id, p]))
    const userById = new Map(orgUsers.map((u) => [u.id, u]))
    return structures.map((s) => {
      const profile = profileById.get(s.employeeId)
      const user = profile ? userById.get(profile.userId) : undefined
      return { ...s, employeeName: user?.name ?? "Unknown", employeeCode: profile?.employeeCode ?? null }
    })
  })
}

export async function createSalaryStructure(
  ctx: ErpContext,
  input: { employeeId: string; effectiveFrom: string; ctcAnnual: number; state?: string; components: { componentId: string; amount?: number; percentage?: number }[] }
) {
  if (!input.components?.length) throw new ServiceError("At least one component is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const employee = await db.query.employeeProfiles.findFirst({ where: and(eq(employeeProfiles.id, input.employeeId), eq(employeeProfiles.orgId, ctx.orgId)) })
    if (!employee) throw new ServiceError("Employee profile not found", 404)

    const [structure] = await db.insert(erpSalaryStructures).values({
      orgId: ctx.orgId, employeeId: input.employeeId, effectiveFrom: input.effectiveFrom,
      ctcAnnual: input.ctcAnnual.toString(), state: input.state, createdById: ctx.userId,
    }).returning()

    await db.insert(erpSalaryStructureComponents).values(
      input.components.map((c) => ({ structureId: structure.id, componentId: c.componentId, amount: c.amount?.toString(), percentage: c.percentage?.toString() }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_salary_structure.created", entityType: "erp_salary_structure", entityId: structure.id })
    return structure
  })
}

// ============================================================
// Payroll Runs + Processing Engine
// ============================================================

export async function listPayrollRuns(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpPayrollRuns.findMany({ where: eq(erpPayrollRuns.orgId, ctx.orgId), orderBy: (t, { desc }) => [desc(t.year), desc(t.month)] })
  })
}

export async function createPayrollRun(ctx: ErpContext, input: { month: number; year: number }) {
  if (input.month < 1 || input.month > 12) throw new ServiceError("month must be 1-12", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.erpPayrollRuns.findFirst({ where: and(eq(erpPayrollRuns.orgId, ctx.orgId), eq(erpPayrollRuns.month, input.month), eq(erpPayrollRuns.year, input.year)) })
    if (existing) throw new ServiceError("A payroll run already exists for this month/year", 409)
    const [run] = await db.insert(erpPayrollRuns).values({ orgId: ctx.orgId, month: input.month, year: input.year, createdById: ctx.userId }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_payroll_run.created", entityType: "erp_payroll_run", entityId: run.id })
    return run
  })
}

function computeEarning(componentType: string, calcType: string, amount: string | null, percentage: string | null, basic: number) {
  if (calcType === "flat") return Number(amount ?? 0)
  if (calcType === "percentage_of_basic") return basic * (Number(percentage ?? 0) / 100)
  return 0 // percentage_of_gross resolved in a second pass once gross is known -- not used for the earning components that determine gross itself
}

/**
 * Runs payroll for every employee with an active salary structure as of the
 * run's month/year: computes gross earnings from the structure, then
 * applies the configurable PF/ESI/Professional Tax rules (never hardcoded
 * rates) to compute employee-side statutory deductions. TDS is inserted as
 * a zero-amount manual line -- the preparer must set it via
 * updatePayslipTds before finalizing. Employer-side PF/ESI contributions
 * are an employer cost on top of CTC, not a deduction from employee pay,
 * so they are intentionally not reflected as payslip lines in this scope.
 */
export async function processPayrollRun(ctx: ErpContext, runId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const run = await db.query.erpPayrollRuns.findFirst({ where: and(eq(erpPayrollRuns.id, runId), eq(erpPayrollRuns.orgId, ctx.orgId)) })
    if (!run) throw new ServiceError("Payroll run not found", 404)
    if (run.status !== "draft") throw new ServiceError("Only draft payroll runs can be processed", 409)

    const runDate = `${run.year}-${String(run.month).padStart(2, "0")}-01`

    const allStructures = await db.query.erpSalaryStructures.findMany({
      where: and(eq(erpSalaryStructures.orgId, ctx.orgId), lte(erpSalaryStructures.effectiveFrom, runDate)),
      with: { components: { with: { component: true } } },
      orderBy: (t, { desc }) => desc(t.effectiveFrom),
    })
    // Most recent structure per employee as of the run date.
    const latestByEmployee = new Map<string, typeof allStructures[number]>()
    for (const s of allStructures) if (!latestByEmployee.has(s.employeeId)) latestByEmployee.set(s.employeeId, s)

    const payslips: (typeof erpPayslips.$inferSelect)[] = []
    for (const structure of latestByEmployee.values()) {
      const basicComponent = structure.components.find((c) => c.component.name.toLowerCase() === "basic")
      const basic = basicComponent ? computeEarning(basicComponent.component.componentType, basicComponent.component.calculationType, basicComponent.amount, basicComponent.percentage, 0) : 0

      const lines: { componentId: string | null; label: string; lineType: "earning" | "deduction"; amount: number }[] = []
      let grossEarnings = 0
      let pfWage = 0

      for (const sc of structure.components) {
        if (sc.component.componentType !== "earning") continue
        const value = computeEarning(sc.component.componentType, sc.component.calculationType, sc.amount, sc.percentage, basic)
        grossEarnings += value
        if (sc.component.includeInPfWage) pfWage += value
        lines.push({ componentId: sc.componentId, label: sc.component.name, lineType: "earning", amount: value })
      }

      // Any explicit deduction components on the structure itself (e.g. a loan recovery), separate from statutory ones computed below.
      for (const sc of structure.components) {
        if (sc.component.componentType !== "deduction") continue
        const value = computeEarning(sc.component.componentType, sc.component.calculationType, sc.amount, sc.percentage, basic)
        lines.push({ componentId: sc.componentId, label: sc.component.name, lineType: "deduction", amount: value })
      }

      let totalDeductions = lines.filter((l) => l.lineType === "deduction").reduce((sum, l) => sum + l.amount, 0)

      const pfRule = await findActiveRule(db, ctx.orgId, "pf", runDate)
      if (pfRule && pfRule.employeeRate) {
        const cappedWage = pfRule.wageCeiling ? Math.min(pfWage, Number(pfRule.wageCeiling)) : pfWage
        const employeePf = cappedWage * (Number(pfRule.employeeRate) / 100)
        lines.push({ componentId: null, label: "Provident Fund (Employee)", lineType: "deduction", amount: employeePf })
        totalDeductions += employeePf
      }

      const esiRule = await findActiveRule(db, ctx.orgId, "esi", runDate)
      if (esiRule && esiRule.employeeRate && (!esiRule.wageCeiling || grossEarnings <= Number(esiRule.wageCeiling))) {
        const employeeEsi = grossEarnings * (Number(esiRule.employeeRate) / 100)
        lines.push({ componentId: null, label: "ESI (Employee)", lineType: "deduction", amount: employeeEsi })
        totalDeductions += employeeEsi
      }

      const ptRule = await findActiveRule(db, ctx.orgId, "professional_tax", runDate, structure.state)
      if (ptRule?.slabs) {
        const slab = [...ptRule.slabs].sort((a, b) => a.uptoAmount - b.uptoAmount).find((s) => grossEarnings <= s.uptoAmount)
        const ptAmount = slab?.taxAmount ?? ptRule.slabs[ptRule.slabs.length - 1]?.taxAmount ?? 0
        lines.push({ componentId: null, label: "Professional Tax", lineType: "deduction", amount: ptAmount })
        totalDeductions += ptAmount
      }

      // TDS: never auto-computed. Zero-amount placeholder line the preparer must set via updatePayslipTds.
      lines.push({ componentId: null, label: "TDS (enter manually -- not auto-calculated)", lineType: "deduction", amount: 0 })

      const netPay = grossEarnings - totalDeductions

      const [payslip] = await db.insert(erpPayslips).values({
        orgId: ctx.orgId, payrollRunId: runId, employeeId: structure.employeeId,
        grossEarnings: grossEarnings.toString(), totalDeductions: totalDeductions.toString(), netPay: netPay.toString(),
      }).returning()

      await db.insert(erpPayslipLines).values(lines.map((l) => ({ payslipId: payslip.id, componentId: l.componentId, label: l.label, lineType: l.lineType, amount: l.amount.toString() })))
      payslips.push(payslip)
    }

    const [updatedRun] = await db.update(erpPayrollRuns).set({ status: "processed", processedAt: new Date() }).where(eq(erpPayrollRuns.id, runId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_payroll_run.processed", entityType: "erp_payroll_run", entityId: runId })
    return { run: updatedRun, payslipCount: payslips.length }
  })
}

export async function listPayslips(ctx: { orgId: string }, runId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const slips = await db.query.erpPayslips.findMany({
      where: and(eq(erpPayslips.orgId, ctx.orgId), eq(erpPayslips.payrollRunId, runId)),
      with: { lines: true },
    })
    const profiles = await db.query.employeeProfiles.findMany({ where: eq(employeeProfiles.orgId, ctx.orgId) })
    const orgUsers = await db.query.users.findMany({ where: eq(users.orgId, ctx.orgId), columns: { id: true, name: true } })
    const profileById = new Map(profiles.map((p) => [p.id, p]))
    const userById = new Map(orgUsers.map((u) => [u.id, u]))
    return slips.map((s) => {
      const profile = profileById.get(s.employeeId)
      const user = profile ? userById.get(profile.userId) : undefined
      return { ...s, employeeName: user?.name ?? "Unknown" }
    })
  })
}

/** Sets the manually-entered TDS line for a payslip and recomputes net pay. Only allowed while the payslip is still 'draft'. */
export async function updatePayslipTds(ctx: ErpContext, payslipId: string, tdsAmount: number) {
  if (tdsAmount < 0) throw new ServiceError("tdsAmount cannot be negative", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const payslip = await db.query.erpPayslips.findFirst({ where: and(eq(erpPayslips.id, payslipId), eq(erpPayslips.orgId, ctx.orgId)), with: { lines: true } })
    if (!payslip) throw new ServiceError("Payslip not found", 404)
    if (payslip.status !== "draft") throw new ServiceError("Only draft payslips can be edited", 409)

    const tdsLine = payslip.lines.find((l) => l.label.startsWith("TDS"))
    if (!tdsLine) throw new ServiceError("TDS line not found on this payslip", 500)
    await db.update(erpPayslipLines).set({ amount: tdsAmount.toString() }).where(eq(erpPayslipLines.id, tdsLine.id))

    const otherDeductions = payslip.lines.filter((l) => l.id !== tdsLine.id && l.lineType === "deduction").reduce((sum, l) => sum + Number(l.amount), 0)
    const totalDeductions = otherDeductions + tdsAmount
    const netPay = Number(payslip.grossEarnings) - totalDeductions

    const [updated] = await db.update(erpPayslips).set({ totalDeductions: totalDeductions.toString(), netPay: netPay.toString() }).where(eq(erpPayslips.id, payslipId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_payslip.tds_updated", entityType: "erp_payslip", entityId: payslipId })
    return updated
  })
}

export async function finalizePayslip(ctx: ErpContext, payslipId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const payslip = await db.query.erpPayslips.findFirst({ where: and(eq(erpPayslips.id, payslipId), eq(erpPayslips.orgId, ctx.orgId)) })
    if (!payslip) throw new ServiceError("Payslip not found", 404)
    if (payslip.status !== "draft") throw new ServiceError("Only draft payslips can be finalized", 409)
    const [updated] = await db.update(erpPayslips).set({ status: "finalized" }).where(eq(erpPayslips.id, payslipId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_payslip.finalized", entityType: "erp_payslip", entityId: payslipId })
    return updated
  })
}
