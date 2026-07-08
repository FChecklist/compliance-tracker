// Wave 56 (VERI ERP gap-fill, Tier 2 #5/#6): Indian Statutory Payroll.
// Deliberately scoped narrower than ERP_BENCHMARK_COMPARISON.md's full ask:
// PF, ESI, and Professional Tax are computed by a real rule engine whose
// rates/ceilings/slabs live in erp_statutory_rules as admin-editable master
// data -- never hardcoded here -- since these change via periodic
// government notification (see VAIOS_ARCHITECTURE_STRATEGY.md's payroll
// section). TDS (income tax) was originally NOT auto-computed at all
// (real risk of an incorrect statutory deduction without a real slab
// engine) -- Wave 68 below now provides that real engine as an opt-in:
// an employee with no incomeTaxSlabId assigned keeps this original
// manual-entry-only behavior unchanged.
import {
  erpSalaryComponents, erpSalaryStructures, erpSalaryStructureComponents,
  erpStatutoryRules, erpPayrollRuns, erpPayslips, erpPayslipLines,
  erpIncomeTaxSlabs, erpIncomeTaxSlabRates, erpEmployeeTaxExemptions,
  employeeProfiles, users,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, lte, or, isNull, gte, sql } from "drizzle-orm"
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
  return 0 // percentage_of_gross resolved in the explicit second pass below, once gross-so-far is known
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

      // Gap closure, 2026-07-09: split into two passes -- flat/
      // percentage_of_basic components first (contribute to gross), then
      // percentage_of_gross components against that gross-so-far. Before
      // this fix, computeEarning() returned 0 for percentage_of_gross with
      // no second pass ever actually implemented -- any component
      // configured that way silently zeroed out and inserted a real
      // 0-amount payslip line with no error, understating net pay.
      const grossPendingComponents: typeof structure.components = []
      for (const sc of structure.components) {
        if (sc.component.componentType !== "earning") continue
        if (sc.component.calculationType === "percentage_of_gross") {
          grossPendingComponents.push(sc)
          continue
        }
        const value = computeEarning(sc.component.componentType, sc.component.calculationType, sc.amount, sc.percentage, basic)
        grossEarnings += value
        if (sc.component.includeInPfWage) pfWage += value
        lines.push({ componentId: sc.componentId, label: sc.component.name, lineType: "earning", amount: value })
      }
      for (const sc of grossPendingComponents) {
        const value = grossEarnings * (Number(sc.percentage ?? 0) / 100)
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
        const sortedSlabs = [...ptRule.slabs].sort((a, b) => a.uptoAmount - b.uptoAmount)
        const slab = sortedSlabs.find((s) => grossEarnings <= s.uptoAmount)
        if (slab) {
          lines.push({ componentId: null, label: "Professional Tax", lineType: "deduction", amount: slab.taxAmount })
          totalDeductions += slab.taxAmount
        } else {
          // Gap closure, 2026-07-09: previously silently fell back to the
          // highest configured slab's rate when gross exceeded every slab's
          // uptoAmount -- indistinguishable from a genuinely-intended
          // top-band rate, masking a real admin misconfiguration (the slab
          // table should have a final open-ended "and above" band). Now
          // surfaces the same way the TDS line already does when
          // unconfigured, instead of guessing a number.
          lines.push({ componentId: null, label: "Professional Tax (slab table has no open-ended top band for this gross -- enter manually)", lineType: "deduction", amount: 0 })
        }
      }

      // Wave 68: if this employee has an income tax slab assigned, auto-
      // compute a suggested monthly TDS via computeAnnualTds -- projecting
      // this month's gross across 12 months (a deliberate simplification,
      // same spirit as Wave 56's own documented scope boundaries: it does
      // not account for mid-year salary changes, multiple employers, or
      // income outside VERIDIAN). The preparer can still override the
      // amount via updatePayslipTds before finalizing, same as before.
      const employeeProfile = await db.query.employeeProfiles.findFirst({ where: eq(employeeProfiles.id, structure.employeeId) })
      let tdsAmount = 0
      let tdsLabel = "TDS (enter manually -- not auto-calculated)"
      if (employeeProfile?.incomeTaxSlabId) {
        const financialYear = run.month >= 4 ? `${run.year}-${String(run.year + 1).slice(2)}` : `${run.year - 1}-${String(run.year).slice(2)}`
        const annualTax = await computeAnnualTds(db, ctx.orgId, employeeProfile.incomeTaxSlabId, structure.employeeId, financialYear, grossEarnings * 12)
        if (annualTax !== null) {
          tdsAmount = annualTax / 12
          tdsLabel = "TDS (auto-computed -- review before finalizing)"
        }
      }
      lines.push({ componentId: null, label: tdsLabel, lineType: "deduction", amount: tdsAmount })
      totalDeductions += tdsAmount

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

// ============================================================
// Wave 68: Income Tax Slabs (payroll TDS engine) -- admin-editable master
// data, never hardcoded, same discipline as erp_statutory_rules above.
// Old regime vs. new regime is two separate slab records, not a flag.
// ============================================================

export async function listIncomeTaxSlabs(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const slabs = await db.query.erpIncomeTaxSlabs.findMany({ where: eq(erpIncomeTaxSlabs.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.effectiveFrom) })
    const allRates = await db.query.erpIncomeTaxSlabRates.findMany({ where: sql`${erpIncomeTaxSlabRates.slabId} IN (SELECT id FROM compliance.erp_income_tax_slabs WHERE org_id = ${ctx.orgId})` })
    return slabs.map((s) => ({ ...s, rates: allRates.filter((r) => r.slabId === s.id).sort((a, b) => Number(a.fromAmount) - Number(b.fromAmount)) }))
  })
}

export async function createIncomeTaxSlab(
  ctx: ErpContext,
  input: { name: string; effectiveFrom: string; standardDeduction?: number; rates: { fromAmount: number; toAmount?: number; percentDeduction: number }[] }
) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  if (!input.rates?.length) throw new ServiceError("At least one slab rate is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [slab] = await db.insert(erpIncomeTaxSlabs).values({
      orgId: ctx.orgId, name: input.name, effectiveFrom: input.effectiveFrom, standardDeduction: (input.standardDeduction ?? 0).toString(),
    }).returning()
    await db.insert(erpIncomeTaxSlabRates).values(
      input.rates.map((r) => ({ slabId: slab.id, fromAmount: r.fromAmount.toString(), toAmount: r.toAmount?.toString(), percentDeduction: r.percentDeduction.toString() }))
    )
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_income_tax_slab.created", entityType: "erp_income_tax_slab", entityId: slab.id })
    return slab
  })
}

/** Assigns (or clears, if slabId is undefined) an employee's income tax slab -- the opt-in switch for payroll TDS auto-computation. */
export async function assignIncomeTaxSlab(ctx: ErpContext, employeeId: string, slabId: string | undefined) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const employee = await db.query.employeeProfiles.findFirst({ where: and(eq(employeeProfiles.id, employeeId), eq(employeeProfiles.orgId, ctx.orgId)) })
    if (!employee) throw new ServiceError("Employee not found", 404)
    if (slabId) {
      const slab = await db.query.erpIncomeTaxSlabs.findFirst({ where: and(eq(erpIncomeTaxSlabs.id, slabId), eq(erpIncomeTaxSlabs.orgId, ctx.orgId)) })
      if (!slab) throw new ServiceError("Income tax slab not found", 404)
    }
    const [updated] = await db.update(employeeProfiles).set({ incomeTaxSlabId: slabId ?? null, updatedAt: new Date() }).where(eq(employeeProfiles.id, employeeId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_employee.income_tax_slab_assigned", entityType: "employee_profile", entityId: employeeId })
    return updated
  })
}

export async function listEmployeeTaxExemptions(ctx: { orgId: string }, employeeId: string, financialYear?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpEmployeeTaxExemptions.findMany({
      where: financialYear
        ? and(eq(erpEmployeeTaxExemptions.orgId, ctx.orgId), eq(erpEmployeeTaxExemptions.employeeId, employeeId), eq(erpEmployeeTaxExemptions.financialYear, financialYear))
        : and(eq(erpEmployeeTaxExemptions.orgId, ctx.orgId), eq(erpEmployeeTaxExemptions.employeeId, employeeId)),
      orderBy: (t, { desc }) => desc(t.financialYear),
    })
  })
}

export async function createEmployeeTaxExemption(ctx: ErpContext, input: { employeeId: string; financialYear: string; category: string; amount: number }) {
  if (!input.financialYear?.trim()) throw new ServiceError("financialYear is required", 400)
  if (!input.category?.trim()) throw new ServiceError("category is required", 400)
  if (!input.amount || input.amount < 0) throw new ServiceError("amount must be a non-negative number", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const employee = await db.query.employeeProfiles.findFirst({ where: and(eq(employeeProfiles.id, input.employeeId), eq(employeeProfiles.orgId, ctx.orgId)) })
    if (!employee) throw new ServiceError("Employee not found", 404)
    const [exemption] = await db.insert(erpEmployeeTaxExemptions).values({
      orgId: ctx.orgId, employeeId: input.employeeId, financialYear: input.financialYear, category: input.category, amount: input.amount.toString(),
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_employee_tax_exemption.created", entityType: "erp_employee_tax_exemption", entityId: exemption.id })
    return exemption
  })
}

/**
 * Projects annualGrossIncome through the assigned slab's rates
 * progressively (each band taxed only on the portion of income falling
 * within it), after subtracting the slab's standard deduction and the
 * employee's declared exemptions for financialYear. Returns null if the
 * slab has no rates configured (nothing to compute from) -- the caller
 * then falls back to the original manual-entry-only behavior.
 */
async function computeAnnualTds(db: TenantDb, orgId: string, slabId: string, employeeId: string, financialYear: string, annualGrossIncome: number): Promise<number | null> {
  const slab = await db.query.erpIncomeTaxSlabs.findFirst({ where: and(eq(erpIncomeTaxSlabs.id, slabId), eq(erpIncomeTaxSlabs.orgId, orgId)) })
  if (!slab) return null
  const rates = await db.query.erpIncomeTaxSlabRates.findMany({ where: eq(erpIncomeTaxSlabRates.slabId, slabId), orderBy: (t, { asc }) => asc(t.fromAmount) })
  if (!rates.length) return null

  const exemptions = await db.query.erpEmployeeTaxExemptions.findMany({ where: and(eq(erpEmployeeTaxExemptions.orgId, orgId), eq(erpEmployeeTaxExemptions.employeeId, employeeId), eq(erpEmployeeTaxExemptions.financialYear, financialYear)) })
  const totalExemptions = exemptions.reduce((sum, e) => sum + Number(e.amount), 0)

  const taxableIncome = Math.max(0, annualGrossIncome - Number(slab.standardDeduction) - totalExemptions)

  let tax = 0
  for (const rate of rates) {
    const bandFrom = Number(rate.fromAmount)
    const bandTo = rate.toAmount !== null ? Number(rate.toAmount) : Infinity
    if (taxableIncome <= bandFrom) break
    const amountInBand = Math.min(taxableIncome, bandTo) - bandFrom
    tax += amountInBand * (Number(rate.percentDeduction) / 100)
  }
  return tax
}
