"use client";

import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

// GAP-ERP-CRM-403-NO-UX-EXPLANATION fix: the backing service (see
// erp-enablement-service.ts / crm-enablement-service.ts's requireErpEnabled
// / requireSalesEnabled) already returns a real, Owner-worded 403 `error`
// message when a module isn't enabled for the org -- pages just weren't
// surfacing it, so a fresh self-signup org saw silently-empty lists instead
// of an explanation. Unlike pms/page.tsx's "not enabled" card, ERP/CRM have
// no self-service Settings toggle yet (AppSidebar.tsx's own comment on the
// finance nav section), so this deliberately has no "Go to Settings" CTA --
// only the real backend message, which already tells the user to contact
// their admin.
export function ModuleAccessNotice({ message }: { message: string }) {
  return (
    <Card className="rounded-xl shadow-card bg-white max-w-lg mx-auto mt-12">
      <CardContent className="pt-6 text-center space-y-3">
        <Lock className="size-10 text-ct-teal mx-auto" />
        <h2 className="font-heading text-xl text-ct-navy">This module isn&apos;t available yet</h2>
        <p className="text-sm text-ct-muted">{message}</p>
      </CardContent>
    </Card>
  );
}
