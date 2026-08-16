"use client";

import { Card } from "@/components/ui/card";

// Honest "not applicable" notice, styled distinct from an access-denied
// error (this is a business-applicability fact, not a permission failure)
// -- matching the mockup's sectorGate() principle.
export function SectorGateNotice({ title, entityType, applicableTo }: { title: string; entityType: string | undefined; applicableTo: string }) {
  return (
    <div className="space-y-4">
      <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">{title}</h1>
      <Card className="rounded-xl bg-ct-cloud/50 p-6 text-center">
        <p className="text-sm font-medium text-ct-navy">Not applicable to your current entity type</p>
        <p className="text-xs text-ct-muted mt-1">
          Current entity type: <strong>{entityType ?? "general"}</strong>. This module applies to: {applicableTo}.
          Change entity type in Settings to preview it.
        </p>
      </Card>
    </div>
  );
}
