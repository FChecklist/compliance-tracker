// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchHrEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "attendance_calculator": {
      const { calculateAttendancePercent } = await import("@/lib/engines/hr-engine");
      return { attendancePercent: calculateAttendancePercent(Number(inputs.presentDays), Number(inputs.totalWorkingDays)) };
    }
    case "leave_balance_engine": {
      const { calculateLeaveBalance } = await import("@/lib/engines/hr-engine");
      return { leaveBalance: calculateLeaveBalance(Number(inputs.openingBalance), Number(inputs.accrued), Number(inputs.taken)) };
    }
    case "shift_planner": {
      const { planShifts } = await import("@/lib/engines/hr-engine");
      const employeeIds = inputs.employeeIds as string[];
      const shifts = inputs.shifts as { name: string; capacity: number }[];
      if (!Array.isArray(employeeIds) || !Array.isArray(shifts)) throw new Error("employeeIds and shifts must both be arrays");
      return planShifts(employeeIds, shifts);
    }
    case "roster_engine": {
      const { buildRoster } = await import("@/lib/engines/hr-engine");
      const employeeIds = inputs.employeeIds as string[];
      const dates = inputs.dates as string[];
      const rotationPattern = inputs.rotationPattern as string[];
      if (!Array.isArray(employeeIds) || !Array.isArray(dates) || !Array.isArray(rotationPattern)) throw new Error("employeeIds, dates, and rotationPattern must all be arrays");
      return buildRoster(employeeIds, dates, rotationPattern);
    }
    case "experience_calculator": {
      const { calculateExperienceYears } = await import("@/lib/engines/hr-engine");
      return { experienceYears: calculateExperienceYears(String(inputs.fromDate ?? ""), String(inputs.toDate ?? "")) };
    }
    case "notice_period_calculator": {
      const { calculateNoticePeriodEnd } = await import("@/lib/engines/hr-engine");
      return { noticePeriodEndDate: calculateNoticePeriodEnd(String(inputs.resignationDate ?? ""), Number(inputs.noticePeriodDays)) };
    }
    case "probation_calculator": {
      const { calculateProbationEnd } = await import("@/lib/engines/hr-engine");
      return { probationEndDate: calculateProbationEnd(String(inputs.joiningDate ?? ""), Number(inputs.probationMonths)) };
    }
    case "performance_score_calculator": {
      const { calculatePerformanceScore } = await import("@/lib/engines/hr-engine");
      const ratings = inputs.ratings as { competency: string; score: number; weight: number }[];
      if (!Array.isArray(ratings)) throw new Error("ratings must be an array");
      return { performanceScore: calculatePerformanceScore(ratings) };
    }
    case "attrition_calculator": {
      const { calculateAttritionRate } = await import("@/lib/engines/hr-engine");
      return { attritionRatePercent: calculateAttritionRate(Number(inputs.separations), Number(inputs.openingHeadcount), Number(inputs.closingHeadcount)) };
    }
  }

  return NOT_HANDLED
}
