"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface PlanOption {
  id: string;
  name: string;
  userPackSize: number;
  assistantsPerUser: number;
}

interface PlanStatus {
  subscriptionPlanId: string | null;
  subscriptionPlanName: string | null;
  assistantsPerUserLimit: number;
  resolvedViaFallback: boolean;
}

const UNASSIGNED = "__unassigned__";

// GAP-OCID-049-SUBSCRIPTION-PLAN-ENTITLEMENT Task E: admin control for
// organisations.subscriptionPlanId -- previously only settable via a direct
// DB write (confirmed via git grep, OCID_049 certification doc). Follows
// OrgLimitsSection.tsx's exact load/save shape.
export default function SubscriptionPlanSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [selected, setSelected] = useState<string>(UNASSIGNED);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/subscription-plan");
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data.status);
      setPlans(data.plans ?? []);
      setSelected(data.status?.subscriptionPlanId ?? UNASSIGNED);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/subscription-plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionPlanId: selected === UNASSIGNED ? null : selected }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to update subscription plan");
        return;
      }
      setStatus(data.status);
      toast.success("Subscription plan updated");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Skeleton className="h-24 w-full" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-medium">Subscription Plan</h4>
        {status?.resolvedViaFallback && <Badge variant="outline">Auto-resolved by user count</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">
        Currently resolved: <span className="font-medium">{status?.subscriptionPlanName ?? "None"}</span>
        {" "}({status?.assistantsPerUserLimit} AI assistants per user)
      </p>
      {status?.resolvedViaFallback && (
        <p className="text-xs text-muted-foreground">
          No explicit plan is assigned -- the tier above was auto-resolved from your organisation&apos;s
          current user count. Assign a plan explicitly below to pin it regardless of headcount.
        </p>
      )}
      <div className="flex items-end gap-3">
        <div className="flex-1 max-w-[220px]">
          <Label htmlFor="subscription-plan" className="text-xs">Plan</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger id="subscription-plan">
              <SelectValue placeholder="Auto (by user count)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Auto (by user count)</SelectItem>
              {plans.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} -- up to {p.userPackSize} users, {p.assistantsPerUser} assistants/user
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" disabled={saving} onClick={save}>
          {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}
