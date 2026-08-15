// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchAnalyticsEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "trend_analysis_engine": {
      const { analyzeTrend } = await import("@/lib/engines/analytics-engine");
      const values = inputs.values as number[];
      if (!Array.isArray(values)) throw new Error("values must be an array of numbers");
      return analyzeTrend(values.map(Number));
    }
    case "analytics_variance_engine": {
      const { analyzeAnalyticsVariance } = await import("@/lib/engines/analytics-engine");
      return analyzeAnalyticsVariance(Number(inputs.actual), Number(inputs.expected));
    }
    case "benchmark_comparison_engine": {
      const { compareToBenchmark } = await import("@/lib/engines/analytics-engine");
      return compareToBenchmark(Number(inputs.actualValue), Number(inputs.benchmarkValue));
    }
    case "forecast_baseline_engine": {
      const { forecastBaseline } = await import("@/lib/engines/analytics-engine");
      const historicalValues = inputs.historicalValues as number[];
      if (!Array.isArray(historicalValues)) throw new Error("historicalValues must be an array of numbers");
      const method = inputs.method ? String(inputs.method) : undefined;
      if (method && !["naive", "moving_average"].includes(method)) throw new Error("method must be naive or moving_average");
      return { forecast: forecastBaseline(historicalValues.map(Number), method as "naive" | "moving_average" | undefined, inputs.windowSize ? Number(inputs.windowSize) : undefined) };
    }
    case "anomaly_detection_engine": {
      const { detectAnomaliesZScore, detectAnomaliesIqr } = await import("@/lib/engines/analytics-engine");
      const values = inputs.values as number[];
      if (!Array.isArray(values)) throw new Error("values must be an array of numbers");
      const method = inputs.method ? String(inputs.method) : "zscore";
      if (!["zscore", "iqr"].includes(method)) throw new Error("method must be zscore or iqr");
      const anomalies = method === "iqr" ? detectAnomaliesIqr(values.map(Number)) : detectAnomaliesZScore(values.map(Number), inputs.threshold ? Number(inputs.threshold) : undefined);
      return { anomalies };
    }
    case "correlation_calculator": {
      const { calculateCorrelation } = await import("@/lib/engines/analytics-engine");
      const xValues = inputs.xValues as number[];
      const yValues = inputs.yValues as number[];
      if (!Array.isArray(xValues) || !Array.isArray(yValues)) throw new Error("xValues and yValues must both be arrays");
      return { correlation: calculateCorrelation(xValues.map(Number), yValues.map(Number)) };
    }
  }

  return NOT_HANDLED
}
