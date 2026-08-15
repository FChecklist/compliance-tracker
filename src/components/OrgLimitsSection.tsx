"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Users, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface LicenseStatus {
  licensedSeats: number | null;
  activeSeatCount: number;
  seatsAvailable: number | null;
  enforcementEnabled: boolean;
  isOverLimit: boolean;
}

interface CostStatus {
  monthlyCostCapUsd: number | null;
  currentSpendUsd: number;
  spendRemainingUsd: number | null;
  enforcementEnabled: boolean;
  isOverLimit: boolean;
  isNearLimit: boolean;
  forecastedMonthEndSpendUsd: number;
}

// Areas 16/11 admin-UI gap-close (Wave 172's org-license-service.ts /
// cost-guard.ts had no settings surface at all before this).
export default function OrgLimitsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [cost, setCost] = useState<CostStatus | null>(null);
  const [seatsInput, setSeatsInput] = useState("");
  const [seatEnforcement, setSeatEnforcement] = useState(false);
  const [capInput, setCapInput] = useState("");
  const [capEnforcement, setCapEnforcement] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/org-limits");
      if (!res.ok) return;
      const data = await res.json();
      setLicense(data.license);
      setCost(data.cost);
      setSeatsInput(data.license.licensedSeats?.toString() ?? "");
      setSeatEnforcement(data.license.enforcementEnabled);
      setCapInput(data.cost.monthlyCostCapUsd?.toString() ?? "");
      setCapEnforcement(data.cost.enforcementEnabled);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/org-limits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to update");
        return;
      }
      setLicense(data.license);
      setCost(data.cost);
      toast.success("Organisation limits updated");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Seat Licensing</h4>
          {license?.isOverLimit && <Badge variant="destructive">Over limit</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {license?.activeSeatCount} active user{license?.activeSeatCount === 1 ? "" : "s"}
          {license?.licensedSeats !== null && ` of ${license?.licensedSeats} licensed seats`}
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-[180px]">
            <Label htmlFor="licensed-seats" className="text-xs">Licensed seats</Label>
            <Input
              id="licensed-seats"
              type="number"
              min={1}
              placeholder="Unlimited"
              value={seatsInput}
              onChange={(e) => setSeatsInput(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch id="seat-enforcement" checked={seatEnforcement} onCheckedChange={setSeatEnforcement} />
            <Label htmlFor="seat-enforcement" className="text-xs">Enforce limit</Label>
          </div>
          <Button
            size="sm"
            disabled={saving}
            onClick={() =>
              save({
                licensedSeats: seatsInput.trim() === "" ? null : Number(seatsInput),
                seatEnforcementEnabled: seatEnforcement,
              })
            }
          >
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Save
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Monthly AI Spend Cap</h4>
          {cost?.isOverLimit && <Badge variant="destructive">Over cap</Badge>}
          {!cost?.isOverLimit && cost?.isNearLimit && <Badge variant="outline">Near cap</Badge>}
          {!cost?.isOverLimit && cost?.monthlyCostCapUsd !== null && cost !== null && cost.forecastedMonthEndSpendUsd > cost.monthlyCostCapUsd! && (
            <Badge variant="outline">On pace to exceed cap</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          ${cost?.currentSpendUsd.toFixed(2)} spent this month
          {cost?.monthlyCostCapUsd !== null && ` of $${cost?.monthlyCostCapUsd?.toFixed(2)} cap`}
        </p>
        <p className="text-xs text-muted-foreground">
          Forecasted (linear run-rate): ~${cost?.forecastedMonthEndSpendUsd.toFixed(2)} by month end
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-[180px]">
            <Label htmlFor="cost-cap" className="text-xs">Monthly cap (USD)</Label>
            <Input
              id="cost-cap"
              type="number"
              min={1}
              step="0.01"
              placeholder="Unlimited"
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch id="cap-enforcement" checked={capEnforcement} onCheckedChange={setCapEnforcement} />
            <Label htmlFor="cap-enforcement" className="text-xs">Enforce cap</Label>
          </div>
          <Button
            size="sm"
            disabled={saving}
            onClick={() =>
              save({
                monthlyCostCapUsd: capInput.trim() === "" ? null : Number(capInput),
                costCapEnforcementEnabled: capEnforcement,
              })
            }
          >
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
