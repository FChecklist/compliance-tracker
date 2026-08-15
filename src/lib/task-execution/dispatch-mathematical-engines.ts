// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED, parseNumberList } from './dispatch-helpers'

export async function dispatchMathematicalEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    // Mathematical Computation Engine (10 of 13 -- see capability-tree-
    // service.ts's comment for the 3 deferred, matrix/model-input ones).
    case "basic_arithmetic_engine": {
      const { add, subtract, multiply, divide } = await import("@/lib/engines/mathematical-engine");
      const a = Number(inputs.a), b = Number(inputs.b);
      const fn = { add, subtract, multiply, divide }[String(inputs.operation)];
      if (!fn) throw new Error("Invalid operation");
      return { result: fn(a, b) };
    }
    case "scientific_calculator_engine": {
      const { evaluateExpression } = await import("@/lib/engines/mathematical-engine");
      return { result: evaluateExpression(String(inputs.expr ?? "")) };
    }
    case "financial_mathematics_engine": {
      const { presentValue, futureValue, compoundInterest } = await import("@/lib/engines/mathematical-engine");
      const amount = Number(inputs.amount), rate = Number(inputs.rate), periods = Number(inputs.periodsOrYears);
      switch (inputs.operation) {
        case "present_value": return { result: presentValue(amount, rate, periods) };
        case "future_value": return { result: futureValue(amount, rate, periods) };
        case "compound_interest": return { result: compoundInterest(amount, rate, Number(inputs.timesCompoundedPerYear) || 1, periods) };
        default: throw new Error("Invalid operation");
      }
    }
    case "percentage_engine": {
      const { percentageOf, percentageChange } = await import("@/lib/engines/mathematical-engine");
      const value1 = Number(inputs.value1), value2 = Number(inputs.value2);
      if (inputs.operation === "percentage_of") return { result: percentageOf(value1, value2) };
      if (inputs.operation === "percentage_change") return { result: percentageChange(value1, value2) };
      throw new Error("Invalid operation");
    }
    case "ratio_engine": {
      const { simplifyRatio } = await import("@/lib/engines/mathematical-engine");
      const [num, den] = simplifyRatio(Number(inputs.a), Number(inputs.b));
      return { numerator: num, denominator: den };
    }
    case "fraction_engine": {
      const { addFractions } = await import("@/lib/engines/mathematical-engine");
      const [num, den] = addFractions(Number(inputs.n1), Number(inputs.d1), Number(inputs.n2), Number(inputs.d2));
      return { numerator: num, denominator: den };
    }
    case "statistical_engine": {
      const { statisticalSummary } = await import("@/lib/engines/mathematical-engine");
      return statisticalSummary(parseNumberList(inputs.values));
    }
    case "probability_engine": {
      const { combinations, permutations, normalCdf } = await import("@/lib/engines/mathematical-engine");
      switch (inputs.operation) {
        case "combinations": return { result: combinations(Number(inputs.n), Number(inputs.k)) };
        case "permutations": return { result: permutations(Number(inputs.n), Number(inputs.k)) };
        case "normal_cdf": return { result: normalCdf(Number(inputs.n), inputs.k ? Number(inputs.k) : undefined, inputs.stdDev ? Number(inputs.stdDev) : undefined) };
        default: throw new Error("Invalid operation");
      }
    }
    case "regression_engine": {
      const { linearRegression } = await import("@/lib/engines/mathematical-engine");
      const xs = parseNumberList(inputs.xValues), ys = parseNumberList(inputs.yValues);
      if (xs.length !== ys.length || xs.length === 0) throw new Error("X and Y value lists must be the same non-zero length");
      const { slope, intercept } = linearRegression(xs.map((x, i) => [x, ys[i]] as [number, number]));
      return { slope, intercept };
    }
    case "time_series_engine": {
      const { movingAverage } = await import("@/lib/engines/mathematical-engine");
      return { movingAverage: movingAverage(parseNumberList(inputs.values), Number(inputs.windowSize)) };
    }
  }

  return NOT_HANDLED
}
