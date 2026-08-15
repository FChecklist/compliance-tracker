// AI Architecture / Explainability & Transparency gap-closure (2026-07-18).
// "Business Explainability"/"AI Explainability" findings: report-engine's
// note/narrative rendering (ReportDefinitionRunner.tsx -- italic narrative
// box + muted note text) was the only real "explain this AI output" UI
// pattern in the codebase, confined to one component. This extracts that
// same visual language into a generic renderer for the new
// AiDecisionExplanation shape (src/lib/explainability/), so any future AI
// decision surface (CRM, task predictions, and beyond) gets a consistent
// "why" panel for free instead of hand-rolling its own.
import { Badge } from "@/components/ui/badge";
import type { AiDecisionExplanation } from "@/lib/explainability/ai-decision-explanation";

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "border-ct-teal/40 bg-ct-teal/10 text-ct-teal",
  medium: "border-ct-saffron/40 bg-ct-saffron/10 text-ct-saffron",
  low: "border-ct-error/40 bg-ct-error/10 text-ct-error",
};

export function AiDecisionExplanationCard({ explanation }: { explanation: AiDecisionExplanation }) {
  return (
    <div className="space-y-2 rounded-md border border-ct-border bg-white p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-ct-navy">{explanation.summary}</p>
        {explanation.confidence && (
          <Badge variant="outline" className={CONFIDENCE_STYLES[explanation.confidence]}>
            {explanation.confidence} confidence
          </Badge>
        )}
      </div>

      <p className="italic text-ct-navy/90 bg-muted/20 rounded p-2 border border-ct-border">{explanation.reasoning}</p>

      {explanation.recommendedAction && (
        <p>
          <span className="font-medium text-ct-navy">Recommended: </span>
          <span className="text-ct-navy/90">{explanation.recommendedAction}</span>
        </p>
      )}

      {explanation.businessImpact && (
        <p>
          <span className="font-medium text-ct-navy">Impact if acted on: </span>
          <span className="text-ct-navy/90">{explanation.businessImpact}</span>
        </p>
      )}

      {explanation.rejectedAlternatives && explanation.rejectedAlternatives.length > 0 && (
        <div>
          <p className="font-medium text-ct-navy">Other options considered:</p>
          <ul className="list-disc pl-4 text-ct-muted space-y-0.5">
            {explanation.rejectedAlternatives.map((alt, i) => (
              <li key={i}>
                <span className="text-ct-navy/80">{alt.option}</span> — {alt.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {explanation.assumptions && explanation.assumptions.length > 0 && (
        <div>
          <p className="font-medium text-ct-navy">Assumptions made:</p>
          <ul className="list-disc pl-4 text-ct-muted space-y-0.5">
            {explanation.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
