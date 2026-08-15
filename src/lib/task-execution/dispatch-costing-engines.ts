// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED, truthy } from './dispatch-helpers'

export async function dispatchCostingEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    // Costing Engine (8 of 8 registered engines) -- non-manufacturing
    // costing methods (job/contract/service costing, allocation, variance)
    // from costing-engine.ts. The two array-of-objects inputs
    // (activity_based_costing_engine's costPools/objectDriverUsage and
    // cost_allocation_engine's allocationBasis) are dispatch-only -- no UI
    // field type supports a grid/JSON-editor, the same skip pattern the
    // Mathematical Computation Engine's 3 matrix/model-input engines follow
    // above (see capability-tree-service.ts's COSTING_WIRED_ENGINE_INPUT_FIELDS
    // comment).
    case "job_costing_engine": {
      const { calculateJobCost } = await import("@/lib/engines/costing-engine");
      return { result: calculateJobCost(Number(inputs.directMaterial), Number(inputs.directLabor), Number(inputs.overheadAllocated)) };
    }
    case "standard_costing_engine": {
      const { standardCostingVariance } = await import("@/lib/engines/costing-engine");
      return standardCostingVariance({
        standardPrice: Number(inputs.standardPrice),
        actualPrice: Number(inputs.actualPrice),
        standardQuantity: Number(inputs.standardQuantity),
        actualQuantity: Number(inputs.actualQuantity),
      });
    }
    case "marginal_costing_engine": {
      const { marginalCostingAnalysis } = await import("@/lib/engines/costing-engine");
      return marginalCostingAnalysis({
        sellingPricePerUnit: Number(inputs.sellingPricePerUnit),
        variableCostPerUnit: Number(inputs.variableCostPerUnit),
        fixedCosts: Number(inputs.fixedCosts),
      });
    }
    case "activity_based_costing_engine": {
      const { allocateActivityBasedCost } = await import("@/lib/engines/costing-engine");
      const costPools = inputs.costPools;
      if (!Array.isArray(costPools)) throw new Error("costPools must be an array");
      const objectDriverUsage = inputs.objectDriverUsage;
      if (typeof objectDriverUsage !== "object" || objectDriverUsage === null || Array.isArray(objectDriverUsage)) {
        throw new Error("objectDriverUsage must be an object");
      }
      return allocateActivityBasedCost(
        costPools as { activity: string; totalCost: number; totalDriverUnits: number }[],
        objectDriverUsage as Record<string, number>,
      );
    }
    case "batch_costing_engine_2": {
      const { calculateBatchCost } = await import("@/lib/engines/costing-engine");
      return { result: calculateBatchCost(Number(inputs.totalBatchCost), Number(inputs.unitsInBatch)) };
    }
    case "service_costing_engine": {
      const { calculateServiceCost } = await import("@/lib/engines/costing-engine");
      return { result: calculateServiceCost(Number(inputs.directCost), Number(inputs.indirectCostAllocated), Number(inputs.serviceUnits)) };
    }
    case "cost_allocation_engine": {
      const { allocateCostPool } = await import("@/lib/engines/costing-engine");
      const allocationBasis = inputs.allocationBasis;
      if (!Array.isArray(allocationBasis)) throw new Error("allocationBasis must be an array");
      return allocateCostPool(Number(inputs.pool), allocationBasis as { id: string; basisValue: number }[]);
    }
    case "variance_analysis_engine": {
      const { analyzeVariance } = await import("@/lib/engines/costing-engine");
      const higherIsFavorable = inputs.higherIsFavorable == null || inputs.higherIsFavorable === ""
        ? true
        : truthy(inputs.higherIsFavorable);
      return analyzeVariance(Number(inputs.actual), Number(inputs.budget), higherIsFavorable);
    }
  }

  return NOT_HANDLED
}
