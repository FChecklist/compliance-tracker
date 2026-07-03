"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Zap, Trash2 } from "lucide-react";
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
  id: string; name: string; description: string | null; triggerType: string;
  actionType: string; actionConfig: { userId?: string; title?: string; message?: string; description?: string };
  isActive: boolean;
};

const TRIGGER_TYPES = [
  { value: "notice.status_changed", label: "Notice status changes" },
  { value: "pms_issue.status_changed", label: "PMS issue status changes" },
];

export default function AutomationPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState("notice.status_changed");
  const [actionType, setActionType] = useState<"notify_user" | "create_task">("notify_user");
  const [userId, setUserId] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/automation-rules");
    const data = await res.json();
    setRules(data.rules ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createRule = async () => {
    if (!name.trim() || !userId.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/automation-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, description, triggerType, actionType,
          actionConfig: { userId, message: message || undefined, title: name },
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Automation rule created");
      setOpen(false);
      setName(""); setDescription(""); setUserId(""); setMessage("");
      load();
    } catch {
      toast.error("Failed to create automation rule");
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (rule: Rule) => {
    try {
      const res = await fetch(`/api/automation-rules/${rule.id}`, {
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
      const res = await fetch(`/api/automation-rules/${ruleId}`, { method: "DELETE" });
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
          <h1 className="text-2xl font-heading text-ct-navy">Automation Rules</h1>
          <p className="text-sm text-ct-muted mt-1">Deterministic trigger-condition-action rules -- notify or auto-create a task when something changes. No AI, no arbitrary code.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              <Plus className="size-4 mr-2" />
              New Rule
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Automation Rule</DialogTitle>
              <DialogDescription>Fires every time the selected trigger happens for this organisation.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Escalate overdue notices" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Description</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">When</Label>
                <Select value={triggerType} onValueChange={setTriggerType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRIGGER_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Then</Label>
                <Select value={actionType} onValueChange={(v) => setActionType(v as "notify_user" | "create_task")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="notify_user">Notify a user</SelectItem>
                    <SelectItem value="create_task">Create a task</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">User ID</Label>
                <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Target user's ID" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Message</Label>
                <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional custom message" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createRule} disabled={creating || !name.trim() || !userId.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create Rule
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
            <Zap className="size-10 text-ct-muted mx-auto" />
            <p className="text-sm text-ct-muted">No automation rules yet. Create the first one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {rules.map((rule) => (
            <div key={rule.id} className="px-4 py-3 flex items-center gap-3">
              <Zap className="size-4 text-ct-teal shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ct-navy">{rule.name}</p>
                <p className="text-xs text-ct-muted">
                  {TRIGGER_TYPES.find((t) => t.value === rule.triggerType)?.label ?? rule.triggerType}
                  {" -> "}
                  {rule.actionType === "notify_user" ? "Notify user" : "Create task"}
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
