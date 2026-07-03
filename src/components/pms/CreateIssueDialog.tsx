"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type IssueType = { id: string; name: string };
type IssueStatus = { id: string; name: string };

export default function CreateIssueDialog({
  projectId,
  defaultStatusId,
  onCreated,
}: {
  projectId: string;
  defaultStatusId?: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<IssueType[]>([]);
  const [statuses, setStatuses] = useState<IssueStatus[]>([]);
  const [title, setTitle] = useState("");
  const [typeId, setTypeId] = useState("");
  const [statusId, setStatusId] = useState(defaultStatusId ?? "");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      fetch("/api/pms/issue-types").then((r) => r.json()),
      fetch(`/api/pms/issue-statuses?projectId=${projectId}`).then((r) => r.json()),
    ]).then(([typesData, statusesData]) => {
      setTypes(typesData.issueTypes ?? []);
      setStatuses(statusesData.issueStatuses ?? []);
      if (typesData.issueTypes?.length) setTypeId(typesData.issueTypes[0].id);
      if (!defaultStatusId && statusesData.issueStatuses?.length) setStatusId(statusesData.issueStatuses[0].id);
    });
  }, [open, projectId, defaultStatusId]);

  const create = async () => {
    if (!title.trim() || !typeId) return;
    setCreating(true);
    try {
      const res = await fetch("/api/pms/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, typeId, statusId: statusId || undefined, title }),
      });
      if (!res.ok) throw new Error();
      toast.success("Issue created");
      setTitle("");
      setOpen(false);
      onCreated();
    } catch {
      toast.error("Failed to create issue");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
          <Plus className="size-4 mr-2" />
          New Issue
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Issue</DialogTitle>
          <DialogDescription>Create a new issue in this project.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fix login redirect bug" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Type</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Status</Label>
              <Select value={statusId} onValueChange={setStatusId}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={create} disabled={creating || !title.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
            {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
            Create Issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
