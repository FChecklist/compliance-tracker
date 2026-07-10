"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MismatchInfo = {
  id: string;
  comparisonSummary: string;
  resolution: string; // 'unresolved' | 'nudged' | 'confirmed_fine'
  detectedAt: string;
};

/**
 * AI-styled bubble, deliberately never confusable with a human message
 * (distinct background/border + bot icon). Per this feature's own design
 * rule: only ever rendered for the commitment's assigner -- the backend's
 * RLS policy is the real guarantee (a non-assigner's getMessages() call
 * never receives mismatch data at all), this component just renders what
 * it's given.
 */
export function MismatchBubble({ mismatch, onResolved }: { mismatch: MismatchInfo; onResolved: (updated: MismatchInfo) => void }) {
  const [busy, setBusy] = useState(false);

  async function resolve(action: "nudge" | "confirm_fine") {
    setBusy(true);
    try {
      const res = await fetch(`/api/instruction-mismatches/${mismatch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const updated = await res.json();
        onResolved({ ...mismatch, resolution: updated.resolution });
      }
    } finally {
      setBusy(false);
    }
  }

  const resolved = mismatch.resolution !== "unresolved";

  return (
    <div className="flex justify-start my-2">
      <div className="max-w-[80%] rounded-xl border border-ct-saffron/40 bg-ct-saffron/10 px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <Bot className="size-4 text-ct-saffron" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-ct-saffron">VERI -- possible mismatch</span>
        </div>
        <p className="text-sm text-ct-navy">{mismatch.comparisonSummary}</p>
        {!resolved ? (
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve("nudge")}>
              Nudge
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => resolve("confirm_fine")}>
              It&apos;s fine
            </Button>
          </div>
        ) : (
          <p className={cn("text-xs mt-2 font-medium", mismatch.resolution === "nudged" ? "text-ct-saffron" : "text-ct-teal")}>
            {mismatch.resolution === "nudged" ? "Nudged" : "Marked fine"}
          </p>
        )}
      </div>
    </div>
  );
}
