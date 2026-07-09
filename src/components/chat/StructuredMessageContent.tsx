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
