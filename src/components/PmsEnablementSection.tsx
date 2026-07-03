"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Rocket, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

type Enablement = { isEnabled: boolean; enabledAt: string | null; disabledAt: string | null };
type PmsModule = { moduleKey: string; displayName: string; description: string | null };

export default function PmsEnablementSection({ isAdmin }: { isAdmin: boolean }) {
  const [enablement, setEnablement] = useState<Enablement | null>(null);
  const [modules, setModules] = useState<PmsModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pms/enablement");
      const data = await res.json();
      setEnablement(data);
      if (data.isEnabled) {
        const modRes = await fetch("/api/settings/modules?branch=pms");
        const modData = await modRes.json();
        setModules(modData.modules ?? []);
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
      await load();
    } catch {
      toast.error(`Failed to ${enable ? "enable" : "disable"} VERIDIAN AI PMS`);
    } finally {
      setToggling(false);
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
        </>
      )}
    </div>
  );
}
