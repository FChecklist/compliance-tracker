"use client";

import { Circle, CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useComplianceStats } from "@/lib/queries/use-compliance-stats";

export function HealthRibbon() {
  // Shared react-query cache instead of its own /api/compliance/stats
  // fetch-on-mount.
  const { data: stats } = useComplianceStats();

  if (!stats) {
    return (
      <div className="h-12 bg-ct-cream border-b border-ct-border flex items-center px-4 md:px-6">
        <div className="flex gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-7 w-32 rounded-full bg-ct-cloud animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  const chips = [
    {
      icon: CircleAlert,
      label: `${stats.overdue} Overdue`,
      bg: "bg-red-50 border-red-200 text-red-700",
      iconColor: "text-red-500",
    },
    {
      icon: Circle,
      label: `${stats.dueIn30Days} Due in 30 days`,
      bg: "bg-amber-50 border-amber-200 text-amber-700",
      iconColor: "text-amber-500",
    },
    {
      icon: CircleCheck,
      label: `${stats.safe} Safe`,
      bg: "bg-emerald-50 border-emerald-200 text-emerald-700",
      iconColor: "text-emerald-500",
    },
  ];

  return (
    <div className="h-12 bg-ct-cream border-b border-ct-border flex items-center px-4 md:px-6 overflow-x-auto scrollbar-none">
      <div className="flex gap-3 min-w-max">
        {chips.map((chip) => (
          <div
            key={chip.label}
            className={cn(
              "inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap",
              chip.bg
            )}
          >
            <chip.icon className={cn("size-3.5", chip.iconColor)} />
            {chip.label}
          </div>
        ))}
      </div>
    </div>
  );
}