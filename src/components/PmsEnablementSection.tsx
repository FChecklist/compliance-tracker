"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Rocket, Loader2, CheckCircle2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type Enablement = { isEnabled: boolean; enabledAt: string | null; disabledAt: string | null };
type PmsModule = { moduleKey: string; displayName: string; description: string | null };
type BillableRate = { id: string; userId: string | null; hourlyRate: string; validFrom: string };

export default function PmsEnablementSection({ isAdmin }: { isAdmin: boolean }) {
  const [enablement, setEnablement] = useState<Enablement | null>(null);
  const [modules, setModules] = useState<PmsModule[]>([]);
  const [rates, setRates] = useState<BillableRate[]>([]);
  const [newRate, setNewRate] = useState("");
  const [settingRate, setSettingRate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pms/enablement");
      const data = await res.json();
      setEnablement(data);
      if (data.isEnabled) {
        const [modRes, ratesRes] = await Promise.all([
          fetch("/api/settings/modules?branch=pms"),
          fetch("/api/pms/billable-rates"),
        ]);
        const modData = await modRes.json();
        setModules(modData.modules ?? []);
        const ratesData = await ratesRes.json();
        setRates(ratesData.billableRates ?? []);
      }
    } catch {
      // leave enablement null -- render falls back to "not enabled"
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (enable: boolean) => {
    setToggling(true);
    try {
      const res = await fetch("/api/pms/enablement", { method: enable ? "POST" : "DELETE" });
      if (!res.ok) throw new Error();
      toast.success(enable ? "VERIDIAN AI PMS enabled" : "VERIDIAN AI PMS disabled");
      // Priority 18b (Owner directive 2026-07-15, Option B, auto-upgrade
      // Trigger B): enabling a branch may have just auto-upgraded some of
      // this org's stage-0 users to real membership -- surface both counts
      // here so an admin isn't left guessing. `blocked` (already belongs to
      // a different org) is surfaced, not silently dropped.
      if (enable) {
        const data: { stage0AutoUpgrade?: { upgraded: number; blocked: number } } = await res.json().catch(() => ({}));
        const su = data.stage0AutoUpgrade;
        if (su && su.upgraded > 0) toast.success(`${su.upgraded} stage-0 user${su.upgraded === 1 ? "" : "s"} auto-upgraded to full membership`);
        if (su && su.blocked > 0) toast.info(`${su.blocked} stage-0 user${su.blocked === 1 ? "" : "s"} could not auto-upgrade -- already belong to another organization`);
      }
      await load();
    } catch {
      toast.error(`Failed to ${enable ? "enable" : "disable"} VERIDIAN AI PMS`);
    } finally {
      setToggling(false);
    }
  };

  const setOrgDefaultRate = async () => {
    if (!newRate) return;
    setSettingRate(true);
    try {
      const res = await fetch("/api/pms/billable-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hourlyRate: newRate, validFrom: new Date().toISOString().slice(0, 10) }),
      });
      if (!res.ok) throw new Error();
      toast.success("Billable rate updated");
      setNewRate("");
      await load();
    } catch {
      toast.error("Failed to set billable rate");
    } finally {
      setSettingRate(false);
    }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Rocket className="size-4 text-ct-teal" />
          <div>
            <Label className="text-sm font-medium text-ct-navy">VERIDIAN AI PMS</Label>
            <p className="text-xs text-ct-muted">
              Issue tracking, sprints, wiki, time tracking, budgets, and meetings -- a separate, opt-in product branch.
            </p>
          </div>
        </div>
        {isAdmin ? (
          toggling ? (
            <Loader2 className="size-4 animate-spin text-ct-muted" />
          ) : (
            <Switch checked={enablement?.isEnabled ?? false} onCheckedChange={toggle} />
          )
        ) : (
          <Badge variant={enablement?.isEnabled ? "default" : "secondary"} className="text-xs">
            {enablement?.isEnabled ? "Enabled" : "Disabled"}
          </Badge>
        )}
      </div>

      {!isAdmin && (
        <p className="text-xs text-ct-muted bg-ct-cloud rounded-lg p-3">
          Only admins can enable or disable VERIDIAN AI PMS for this organisation.
        </p>
      )}

      {enablement?.isEnabled && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Enabled Modules</Label>
            {modules.map((m) => (
              <div key={m.moduleKey} className="flex items-center gap-2 text-sm text-ct-navy">
                <CheckCircle2 className="size-3.5 text-ct-teal shrink-0" />
                <span className="font-medium">{m.displayName}</span>
                {m.description && <span className="text-xs text-ct-muted">— {m.description}</span>}
              </div>
            ))}
          </div>

          {isAdmin && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Billable Rates</Label>
                <p className="text-xs text-ct-muted">Org default hourly rate, used when time-entry budget actuals have no per-user rate set.</p>
                {rates.filter((r) => r.userId === null).map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm text-ct-navy">
                    <span>₹{Number(r.hourlyRate).toFixed(2)}/hr</span>
                    <span className="text-xs text-ct-muted">since {r.validFrom}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <Input type="number" step="0.01" min="0" placeholder="New default rate" value={newRate} onChange={(e) => setNewRate(e.target.value)} className="h-8 w-40" />
                  <Button size="sm" onClick={setOrgDefaultRate} disabled={settingRate || !newRate}>
                    {settingRate ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5 mr-1" />}
                    Set Rate
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
