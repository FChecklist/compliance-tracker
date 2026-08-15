// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchInventoryEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "fifo_engine": {
      const { consumeFifo } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number; receivedDate?: string; expiryDate?: string }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      return consumeFifo(lots, Number(inputs.quantityToConsume));
    }
    case "fefo_engine": {
      const { consumeFefo } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number; receivedDate?: string; expiryDate?: string }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      return consumeFefo(lots, Number(inputs.quantityToConsume));
    }
    case "weighted_average_engine": {
      const { weightedAverageCost } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      return { weightedAverageCost: weightedAverageCost(lots) };
    }
    case "standard_cost_engine": {
      const { standardCostVariance } = await import("@/lib/engines/inventory-engine");
      return standardCostVariance(Number(inputs.actualCost), Number(inputs.standardCost), Number(inputs.quantity));
    }
    case "moving_average_engine": {
      const { movingAverageAfterReceipt } = await import("@/lib/engines/inventory-engine");
      return { newAverageCost: movingAverageAfterReceipt(Number(inputs.currentQty), Number(inputs.currentAvgCost), Number(inputs.receiptQty), Number(inputs.receiptCost)) };
    }
    case "stock_valuation_engine": {
      const { valueStock } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      const method = inputs.method ? String(inputs.method) : undefined;
      if (method && !["fifo", "weighted_average"].includes(method)) throw new Error("method must be fifo or weighted_average");
      return { stockValue: valueStock(lots, method as "fifo" | "weighted_average" | undefined) };
    }
    case "inventory_aging_engine": {
      const { ageInventory } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number; receivedDate: string }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      const buckets = inputs.buckets as number[] | undefined;
      if (buckets !== undefined && !Array.isArray(buckets)) throw new Error("buckets must be an array of numbers if provided");
      return ageInventory(lots, String(inputs.asOfDate ?? ""), buckets);
    }
    case "eoq_calculator": {
      const { calculateEoq } = await import("@/lib/engines/inventory-engine");
      return { eoq: calculateEoq(Number(inputs.annualDemand), Number(inputs.orderingCostPerOrder), Number(inputs.holdingCostPerUnitPerYear)) };
    }
    case "reorder_level_calculator": {
      const { calculateReorderLevel } = await import("@/lib/engines/inventory-engine");
      return { reorderLevel: calculateReorderLevel(Number(inputs.avgDailyUsage), Number(inputs.leadTimeDays), Number(inputs.safetyStock)) };
    }
    case "safety_stock_calculator": {
      const { calculateSafetyStock } = await import("@/lib/engines/inventory-engine");
      return { safetyStock: calculateSafetyStock(Number(inputs.maxDailyUsage), Number(inputs.maxLeadTimeDays), Number(inputs.avgDailyUsage), Number(inputs.avgLeadTimeDays)) };
    }
    case "abc_analysis_engine": {
      const { abcAnalysis } = await import("@/lib/engines/inventory-engine");
      const items = inputs.items as { id: string; annualUsageValue: number }[];
      if (!Array.isArray(items)) throw new Error("items must be an array");
      return abcAnalysis(items);
    }
    case "xyz_analysis_engine": {
      const { xyzAnalysis } = await import("@/lib/engines/inventory-engine");
      const items = inputs.items as { id: string; demandHistory: number[] }[];
      if (!Array.isArray(items)) throw new Error("items must be an array");
      return xyzAnalysis(items);
    }
    case "slow_moving_inventory_engine": {
      const { findSlowMovingItems } = await import("@/lib/engines/inventory-engine");
      const items = inputs.items as { id: string; quantityOnHand: number; quantityConsumedInWindow: number }[];
      if (!Array.isArray(items)) throw new Error("items must be an array");
      return { slowMovingItemIds: findSlowMovingItems(items, inputs.thresholdTurnoverRatio ? Number(inputs.thresholdTurnoverRatio) : undefined) };
    }
    case "dead_stock_engine": {
      const { findDeadStock } = await import("@/lib/engines/inventory-engine");
      const items = inputs.items as { id: string; quantityOnHand: number; quantityConsumedInWindow: number }[];
      if (!Array.isArray(items)) throw new Error("items must be an array");
      return { deadStockItemIds: findDeadStock(items) };
    }
    case "cycle_counting_engine": {
      const { suggestCycleCountSchedule } = await import("@/lib/engines/inventory-engine");
      const abcClass = String(inputs.abcClass ?? "");
      if (!["A", "B", "C"].includes(abcClass)) throw new Error("abcClass must be A, B, or C");
      return suggestCycleCountSchedule(abcClass as "A" | "B" | "C");
    }
  }

  return NOT_HANDLED
}
