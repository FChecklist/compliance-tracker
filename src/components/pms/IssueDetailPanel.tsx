"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type IssueType = { id: string; name: string; isEpic: boolean };
type IssueStatus = { id: string; name: string; group: string };
type OrgUser = { id: string; name: string; email: string };

type IssueDetail = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  typeId: string;
  statusId: string;
  priority: string;
  assigneeIds: string[];
};

const PRIORITIES = ["no_priority", "urgent", "high", "medium", "low"];

export default function IssueDetailPanel({
  issueId,
  projectId,
  issuePrefix,
  onClose,
  onUpdated,
}: {
  issueId: string | null;
  projectId: string;
  issuePrefix: string | null;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [types, setTypes] = useState<IssueType[]>([]);
  const [statuses, setStatuses] = useState<IssueStatus[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!issueId) return;
    setLoading(true);
    try {
      const [issueRes, typesRes, statusesRes, usersRes] = await Promise.all([
        fetch(`/api/pms/issues/${issueId}`),
        fetch("/api/pms/issue-types"),
        fetch(`/api/pms/issue-statuses?projectId=${projectId}`),
        fetch("/api/users"),
      ]);
      const [issueData, typesData, statusesData, usersData] = await Promise.all([
        issueRes.json(), typesRes.json(), statusesRes.json(), usersRes.json(),
      ]);
      setIssue(issueData);
      setTypes(typesData.issueTypes ?? []);
      setStatuses(statusesData.issueStatuses ?? []);
      setOrgUsers(usersData.users ?? []);
    } catch {
      toast.error("Failed to load issue");
    } finally {
      setLoading(false);
    }
  }, [issueId, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    if (!issue) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/pms/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setIssue((prev) => (prev ? { ...prev, ...updated } : updated));
      onUpdated();
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={!!issueId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {issue ? `${issuePrefix ?? "ISSUE"}-${issue.number}` : "Issue"}
            {saving && <Loader2 className="inline size-3.5 ml-2 animate-spin text-ct-muted" />}
          </SheetTitle>
        </SheetHeader>

        {loading || !issue ? (
          <p className="text-sm text-ct-muted px-4">Loading...</p>
        ) : (
          <div className="space-y-4 px-4 pb-6">
            <Input
              value={issue.title}
              onChange={(e) => setIssue({ ...issue, title: e.target.value })}
              onBlur={(e) => patch({ title: e.target.value })}
              className="text-base font-semibold border-none px-0 focus-visible:ring-0"
            />

            <Textarea
              value={issue.description ?? ""}
              onChange={(e) => setIssue({ ...issue, description: e.target.value })}
              onBlur={(e) => patch({ description: e.target.value })}
              placeholder="Add a description..."
              className="min-h-[100px] text-sm"
            />

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Status</Label>
                <Select value={issue.statusId} onValueChange={(v) => { setIssue({ ...issue, statusId: v }); patch({ statusId: v }); }}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Priority</Label>
                <Select value={issue.priority} onValueChange={(v) => { setIssue({ ...issue, priority: v }); patch({ priority: v }); }}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p.replace("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Type</Label>
                <Select value={issue.typeId} onValueChange={(v) => { setIssue({ ...issue, typeId: v }); patch({ typeId: v }); }}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Assignee</Label>
                <Select
                  value={issue.assigneeIds[0] ?? "__none__"}
                  onValueChange={(v) => {
                    const assigneeIds = v === "__none__" ? [] : [v];
                    setIssue({ ...issue, assigneeIds });
                    patch({ assigneeIds });
                  }}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unassigned</SelectItem>
                    {orgUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />
            <Badge variant="secondary" className="text-xs">
              {types.find((t) => t.id === issue.typeId)?.name ?? "Task"}
            </Badge>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
