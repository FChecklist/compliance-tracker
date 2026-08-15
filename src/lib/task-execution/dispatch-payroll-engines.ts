// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED, truthy } from './dispatch-helpers'

export async function dispatchPayrollEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "gratuity_calculator": {
      const { calculateGratuity } = await import("@/lib/engines/payroll-engine");
      return calculateGratuity({
        lastDrawnMonthlySalary: Number(inputs.lastDrawnMonthlySalary), yearsOfService: Number(inputs.yearsOfService),
        isCoveredUnderAct: inputs.isCoveredUnderAct === undefined ? true : truthy(inputs.isCoveredUnderAct),
      });
    }
    case "eps_calculator": {
      const { calculateEps } = await import("@/lib/engines/payroll-engine");
      return { epsAmount: calculateEps(Number(inputs.monthlyBasicPlusDa)) };
    }
    case "labour_welfare_fund_calculator": {
      const { calculateLwf } = await import("@/lib/engines/payroll-engine");
      return calculateLwf(Number(inputs.employeeContribution), Number(inputs.employerContribution));
    }
    case "bonus_calculator": {
      const { calculateBonus } = await import("@/lib/engines/payroll-engine");
      return { bonusAmount: calculateBonus(Number(inputs.annualBasicPlusDa), Number(inputs.bonusPercent)) };
    }
    case "incentive_calculator": {
      const { calculateIncentive } = await import("@/lib/engines/payroll-engine");
      const incentiveSlabs = inputs.incentiveSlabs as { minAchievementPercent: number; incentivePercentOfTarget: number }[];
      if (!Array.isArray(incentiveSlabs)) throw new Error("incentiveSlabs must be an array");
      return { incentiveAmount: calculateIncentive(Number(inputs.achievedValue), Number(inputs.targetValue), incentiveSlabs) };
    }
    case "commission_calculator": {
      const { calculatePayrollCommission } = await import("@/lib/engines/payroll-engine");
      return { commissionAmount: calculatePayrollCommission(Number(inputs.saleAmount), Number(inputs.commissionRatePercent)) };
    }
    case "overtime_calculator": {
      const { calculateOvertime } = await import("@/lib/engines/payroll-engine");
      return { overtimeAmount: calculateOvertime(Number(inputs.monthlyBasicPlusDa), Number(inputs.standardMonthlyHours), Number(inputs.overtimeHours), inputs.multiplier ? Number(inputs.multiplier) : undefined) };
    }
    case "shift_allowance_calculator": {
      const { calculateShiftAllowance } = await import("@/lib/engines/payroll-engine");
      return { allowanceAmount: calculateShiftAllowance(Number(inputs.shiftDays), Number(inputs.allowancePerShift)) };
    }
    case "leave_encashment_calculator": {
      const { calculateLeaveEncashment } = await import("@/lib/engines/payroll-engine");
      return { encashmentAmount: calculateLeaveEncashment(Number(inputs.lastDrawnMonthlySalary), Number(inputs.unusedLeaveDays)) };
    }
    case "superannuation_calculator": {
      const { calculateSuperannuation } = await import("@/lib/engines/payroll-engine");
      return { superannuationAmount: calculateSuperannuation(Number(inputs.annualBasic), inputs.contributionPercent ? Number(inputs.contributionPercent) : undefined) };
    }
    case "full_final_settlement_calculator": {
      const { calculateFullAndFinalSettlement } = await import("@/lib/engines/payroll-engine");
      return { settlementAmount: calculateFullAndFinalSettlement({
        unpaidSalary: Number(inputs.unpaidSalary), leaveEncashment: Number(inputs.leaveEncashment),
        gratuity: inputs.gratuity ? Number(inputs.gratuity) : undefined, bonus: inputs.bonus ? Number(inputs.bonus) : undefined,
        recoveries: inputs.recoveries ? Number(inputs.recoveries) : undefined,
      }) };
    }
    case "arrear_calculator": {
      const { calculateArrears } = await import("@/lib/engines/payroll-engine");
      return { arrearAmount: calculateArrears(Number(inputs.revisedMonthlyPay), Number(inputs.originalMonthlyPay), Number(inputs.affectedMonths)) };
    }
    case "increment_calculator": {
      const { calculateIncrement } = await import("@/lib/engines/payroll-engine");
      return calculateIncrement(Number(inputs.currentSalary), Number(inputs.incrementPercent));
    }
    case "salary_revision_calculator": {
      const { calculateSalaryRevision } = await import("@/lib/engines/payroll-engine");
      const components = inputs.components as Record<string, number>;
      if (!components || typeof components !== "object" || Array.isArray(components)) throw new Error("components must be an object of {component: amount}");
      return calculateSalaryRevision(components, Number(inputs.revisionPercent));
    }
  }

  return NOT_HANDLED
}
