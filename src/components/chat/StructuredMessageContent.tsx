"use client";

// Wave 151 (Phase4_Implementation_Plan.md, structured-response renderer v1).
//
// Read-only renderer for the two structured content types defined in
// structured-message.ts. This is v1: the "confirmation" type's actionLabel
// is rendered as a visually distinct but NON-FUNCTIONAL label (no onClick)
// -- it communicates intent, it does not execute anything. Wiring it to a
// real action is future work and would belong on the generation/agent side,
// not here.
//
// Styling reuses the existing shadcn Card primitives from ui/card.tsx
// exactly as imported -- no new Tailwind color classes beyond what those
// primitives already provide. Text sizing matches MessageContent.tsx
// (text-sm) so structured and plain messages sit at the same scale inside
// a thread.
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { StructuredMessage } from "@/lib/structured-message"

export function StructuredMessageContent({
  data,
}: {
  data: StructuredMessage
}) {
  if (data.type === "summary") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{data.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="text-sm space-y-1.5">
            {data.items.map((item, i) => (
              <div key={i} className="flex gap-2">
                <dt className="font-medium">{item.label}</dt>
                <dd className="break-words">{item.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    )
  }

  // Calculation Explainability (VERIDIAN Review Framework gap closure,
  // 2026-07-18): a VCEL engine result, plus an optional step-by-step
  // breakdown when the dispatched engine's output carried one (see
  // src/lib/engines/breakdown.ts). `steps` renders as an ordered list
  // rather than a second dl so it visually reads as "how we got the
  // result above", not a second flat result.
  if (data.type === "calculation") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {data.engineName}
            {data.engineVersion && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">v{data.engineVersion}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="text-sm space-y-1.5">
            {data.result.map((item, i) => (
              <div key={i} className="flex gap-2">
                <dt className="font-medium">{item.label}</dt>
                <dd className="break-words">{item.value}</dd>
              </div>
            ))}
          </dl>
          {data.steps && data.steps.length > 0 && (
            <div className="border-t pt-2.5">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">How this was calculated</p>
              <ol className="text-sm space-y-1.5">
                {data.steps.map((step, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs text-muted-foreground">{i + 1}.</span>
                    <span>{step.label}</span>
                    {step.formula && <span className="text-xs text-muted-foreground">({step.formula})</span>}
                    <span className="font-medium ml-auto">{step.value}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  // data.type === "confirmation"
  return (
    <Card>
      <CardContent className="space-y-3">
        <p className="text-sm break-words [&_p]:whitespace-pre-wrap">
          {data.message}
        </p>
        {/* v1: read-only label, NOT a live button. No onClick handler. */}
        <span className="inline-block rounded-md border px-2.5 py-1 text-sm font-medium">
          {data.actionLabel}
        </span>
      </CardContent>
    </Card>
  )
}
