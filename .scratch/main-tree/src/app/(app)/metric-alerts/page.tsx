"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 38 (Grafana-inspired scheduled threshold alerting, PLATFORM_STRATEGY.md
// §22). Mirrors /automation's own UI shape (single-page CRUD list + create
// dialog, no picker widgets -- matching that page's own deliberate
// simplicity) rather than a heavier dashboard-builder UI like Grafana's.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Loader2, BellRing, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

type Rule = {
  id: string; name: string; sourceEntity: string; filterField: string | null; filterValue: string | null;
  operator: string; threshold: number; notifyUserIds: string[]; isActive: boolean; lastTriggeredAt: string | null;
};

const SOURCE_ENTITIES = [
  { value: "compliance_items", label: "Compliance Items" },
  { value: "notices", label: "Notices" },
  { value: "risks", label: "Risks" },
  { value: "pms_issues", label: "PMS Issues" },
  { value: "incidents", label: "Incidents" },
];

const OPERATORS = [
  { value: "gt", label: "is greater than" },
  { value: "gte", label: "is greater than or equal to" },
  { value: "lt", label: "is less than" },
  { value: "lte", label: "is less than or equal to" },
  { value: "eq", label: "equals" },
];

export default function MetricAlertsPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [sourceEntity, setSourceEntity] = useState("compliance_items");
  const [filterField, setFilterField] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [operator, setOperator] = useState("gt");
  const [threshold, setThreshold] = useState("");
  const [notifyUserId, setNotifyUserId] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/metric-alert-rules");
    const data = await res.json();
    setRules(data.rules ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createRule = async () => {
    if (!name.trim() || !threshold.trim() || !notifyUserId.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/metric-alert-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, sourceEntity, operator, threshold: Number(threshold),
          filterField: filterField.trim() || undefined, filterValue: filterValue.trim() || undefined,
          notifyUserIds: [notifyUserId.trim()],
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Metric alert rule created");
      setOpen(false);
      setName(""); setFilterField(""); setFilterValue(""); setThreshold(""); setNotifyUserId("");
      load();
    } catch {
      toast.error("Failed to create metric alert rule");
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (rule: Rule) => {
    try {
      const res = await fetch(`/api/metric-alert-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Failed to update rule");
    }
  };

  const removeRule = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/metric-alert-rules/${ruleId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Rule deleted");
      load();
    } catch {
      toast.error("Failed to delete rule");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Metric Alerts</h1>
          <p className="text-sm text-ct-muted mt-1">Scheduled threshold alerts over your org's data, checked daily -- notify me when a metric crosses a threshold. Evaluated by a cron job, not a live dashboard.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              <Plus className="size-4 mr-2" />
              New Alert
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Metric Alert</DialogTitle>
              <DialogDescription>Checked once daily. Notifies the given user when the condition is met.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Too many overdue items" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Count of</Label>
                <Select value={sourceEntity} onValueChange={setSourceEntity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCE_ENTITIES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Filter field (optional)</Label>
                  <Input value={filterField} onChange={(e) => setFilterField(e.target.value)} placeholder="status" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Filter value</Label>
                  <Input value={filterValue} onChange={(e) => setFilterValue(e.target.value)} placeholder="overdue" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Operator</Label>
                  <Select value={operator} onValueChange={setOperator}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Threshold</Label>
                  <Input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="20" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Notify user ID</Label>
                <Input value={notifyUserId} onChange={(e) => setNotifyUserId(e.target.value)} placeholder="Target user's ID" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createRule} disabled={creating || !name.trim() || !threshold.trim() || !notifyUserId.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create Alert
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : rules.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center space-y-2">
            <BellRing className="size-10 text-ct-muted mx-auto" />
            <p className="text-sm text-ct-muted">No metric alerts yet. Create the first one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {rules.map((rule) => (
            <div key={rule.id} className="px-4 py-3 flex items-center gap-3">
              <BellRing className="size-4 text-ct-teal shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ct-navy">{rule.name}</p>
                <p className="text-xs text-ct-muted">
                  {SOURCE_ENTITIES.find((s) => s.value === rule.sourceEntity)?.label ?? rule.sourceEntity}
                  {rule.filterField ? ` (${rule.filterField}=${rule.filterValue})` : ""}
                  {" count "}{OPERATORS.find((o) => o.value === rule.operator)?.label ?? rule.operator}{" "}{rule.threshold}
                  {rule.lastTriggeredAt ? ` -- last fired ${new Date(rule.lastTriggeredAt).toLocaleDateString()}` : ""}
                </p>
              </div>
              <Badge variant={rule.isActive ? "default" : "secondary"} className="text-xs">
                {rule.isActive ? "Active" : "Paused"}
              </Badge>
              <Switch checked={rule.isActive} onCheckedChange={() => toggleActive(rule)} />
              <Button variant="ghost" size="sm" onClick={() => removeRule(rule.id)}>
                <Trash2 className="size-3.5 text-ct-error" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
