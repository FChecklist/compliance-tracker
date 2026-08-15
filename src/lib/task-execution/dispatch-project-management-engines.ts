// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchProjectManagementEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "critical_path_engine": {
      const { calculateCriticalPath } = await import("@/lib/engines/project-management-engine");
      const tasks = inputs.tasks as { id: string; duration: number; dependsOn: string[] }[];
      if (!Array.isArray(tasks)) throw new Error("tasks must be an array");
      return { criticalPath: calculateCriticalPath(tasks) };
    }
    case "resource_allocation_engine": {
      const { allocateResources } = await import("@/lib/engines/project-management-engine");
      const tasks = inputs.tasks as { id: string; requiredCapacity: number; priority: number }[];
      if (!Array.isArray(tasks)) throw new Error("tasks must be an array");
      return allocateResources(tasks, Number(inputs.availableCapacity));
    }
    case "cost_variance_engine": {
      const { calculateCostVariance } = await import("@/lib/engines/project-management-engine");
      return { costVariance: calculateCostVariance(Number(inputs.earnedValue), Number(inputs.actualCost)) };
    }
    case "schedule_variance_engine": {
      const { calculateScheduleVariance } = await import("@/lib/engines/project-management-engine");
      return { scheduleVariance: calculateScheduleVariance(Number(inputs.earnedValue), Number(inputs.plannedValue)) };
    }
    case "earned_value_calculator": {
      const { calculateEarnedValueMetrics } = await import("@/lib/engines/project-management-engine");
      return calculateEarnedValueMetrics({
        plannedValue: Number(inputs.plannedValue), earnedValue: Number(inputs.earnedValue),
        actualCost: Number(inputs.actualCost), budgetAtCompletion: Number(inputs.budgetAtCompletion),
      });
    }
    case "burndown_calculator": {
      const { calculateBurndown } = await import("@/lib/engines/project-management-engine");
      const completedPointsByDay = inputs.completedPointsByDay as number[];
      if (!Array.isArray(completedPointsByDay)) throw new Error("completedPointsByDay must be an array");
      return { burndown: calculateBurndown(Number(inputs.totalStoryPoints), Number(inputs.sprintDays), completedPointsByDay.map(Number)) };
    }
  }

  return NOT_HANDLED
}
