"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Rocket, Plus, Loader2, FolderKanban, Lock, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type Project = {
  id: string;
  name: string;
  description: string | null;
  issuePrefix: string | null;
  healthStatus: string | null;
  status: string;
  accessLevel: "private" | "public";
  rollupPercentage: number;
};

const HEALTH_BADGE: Record<string, string> = {
  on_track: "bg-emerald-100 text-emerald-700",
  at_risk: "bg-amber-100 text-amber-700",
  off_track: "bg-red-100 text-red-700",
};

const PROJECT_STATUSES = ["planning", "active", "paused", "completed", "cancelled"] as const;

export default function PmsHomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [pmsEnabled, setPmsEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [issuePrefix, setIssuePrefix] = useState("");
  const [status, setStatus] = useState<typeof PROJECT_STATUSES[number]>("active");
  const [accessLevel, setAccessLevel] = useState<"private" | "public">("public");
  const [customTabsInput, setCustomTabsInput] = useState("");

  const load = useCallback(async () => {
    try {
      const meRes = await fetch("/api/me");
      const me = await meRes.json();
      setPmsEnabled(me.pmsEnabled ?? false);
      if (!me.pmsEnabled) {
        setLoading(false);
        return;
      }
      const res = await fetch("/api/projects");
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch {
      // leave empty -- render falls back gracefully
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createProject = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const customTabs = customTabsInput
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean)
        .map((label) => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label }));
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, issuePrefix, status, accessLevel, customTabs }),
      });
      if (!res.ok) throw new Error();
      const project = await res.json();
      toast.success("Project created");
      setOpen(false);
      setName("");
      setIssuePrefix("");
      setStatus("active");
      setAccessLevel("public");
      setCustomTabsInput("");
      router.push(`/pms/${project.id}/issues`);
    } catch {
      toast.error("Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!pmsEnabled) {
    return (
      <Card className="rounded-xl shadow-card bg-white max-w-lg mx-auto mt-12">
        <CardContent className="pt-6 text-center space-y-3">
          <Rocket className="size-10 text-ct-teal mx-auto" />
          <h2 className="font-heading text-xl text-ct-navy">VERIDIAN AI PMS is not enabled</h2>
          <p className="text-sm text-ct-muted">
            Ask an organisation admin to enable it from Settings &rarr; Project Management.
          </p>
          <Link href="/settings">
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">Go to Settings</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">VERIDIAN AI PMS</h1>
          <p className="text-sm text-ct-muted mt-1">Projects, issues, sprints, and more.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              <Plus className="size-4 mr-2" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Project</DialogTitle>
              <DialogDescription>Create a new project for issue tracking.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Issue Prefix</Label>
                <Input value={issuePrefix} onChange={(e) => setIssuePrefix(e.target.value.toUpperCase())} placeholder="ENG" maxLength={10} />
                <p className="text-[11px] text-ct-muted">e.g. issues become ENG-1, ENG-2...</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Status</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as typeof PROJECT_STATUSES[number])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROJECT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Access</Label>
                  <Select value={accessLevel} onValueChange={(v) => setAccessLevel(v as "private" | "public")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public -- any org member</SelectItem>
                      <SelectItem value="private">Private -- lead + admins only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Custom Tabs</Label>
                <Input value={customTabsInput} onChange={(e) => setCustomTabsInput(e.target.value)} placeholder="Client Portal, Design Files" />
                <p className="text-[11px] text-ct-muted">Optional, comma-separated extra tab names for this project.</p>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createProject} disabled={creating || !name.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create Project
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {projects.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center space-y-2">
            <FolderKanban className="size-10 text-ct-muted mx-auto" />
            <p className="text-sm text-ct-muted">No projects yet. Create your first project to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link key={p.id} href={`/pms/${p.id}/issues`}>
              <Card className="rounded-xl shadow-card bg-white hover:shadow-lg transition-shadow h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold text-ct-navy flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <FolderKanban className="size-4 text-ct-teal" />
                      {p.name}
                      {p.accessLevel === "private" ? (
                        <Lock className="size-3 text-ct-muted" aria-label="Private project" />
                      ) : (
                        <Globe className="size-3 text-ct-muted" aria-label="Public project" />
                      )}
                    </span>
                    {p.healthStatus && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${HEALTH_BADGE[p.healthStatus] ?? "bg-ct-cloud text-ct-muted"}`}>
                        {p.healthStatus.replace("_", " ")}
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {p.issuePrefix && <p className="text-xs text-ct-muted font-mono">{p.issuePrefix}-*</p>}
                  {p.description && <p className="text-sm text-ct-slate mt-1">{p.description}</p>}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-ct-cloud overflow-hidden">
                      <div className="h-full bg-ct-teal" style={{ width: `${p.rollupPercentage}%` }} />
                    </div>
                    <span className="text-[10px] text-ct-muted font-mono">{p.rollupPercentage}%</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
