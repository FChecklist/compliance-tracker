"use client";

import Link from "next/link";
import { LucideIcon, Rocket } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Real fix for GAP-ERP-CRM-403-NO-UX-EXPLANATION (UMR-20260803-111057-20a8):
// a fresh self-signup org's CRM/ERP page shells rendered but every backing
// API call silently 403'd with no visible explanation. The backend already
// returns a real, human-readable reason (erp-enablement-service.ts's
// requireErpEnabled(), same for CRM) -- the gap was that no page surfaced
// it. This factors out the exact card pms/page.tsx already uses for the
// identical "module not enabled" state, so CRM/ERP pages reuse the
// established pattern instead of inventing a new one.
export function ModuleNotEnabledCard({
  moduleName,
  settingsSection,
  icon: Icon = Rocket,
}: {
  moduleName: string;
  settingsSection: string;
  icon?: LucideIcon;
}) {
  return (
    <Card className="rounded-xl shadow-card bg-white max-w-lg mx-auto mt-12">
      <CardContent className="pt-6 text-center space-y-3">
        <Icon className="size-10 text-ct-teal mx-auto" />
        <h2 className="font-heading text-xl text-ct-navy">{moduleName} is not enabled</h2>
        <p className="text-sm text-ct-muted">
          Ask an organisation admin to enable it from Settings &rarr; {settingsSection}.
        </p>
        <Link href="/settings">
          <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">Go to Settings</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
