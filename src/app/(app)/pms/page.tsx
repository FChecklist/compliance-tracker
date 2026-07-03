"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Rocket, Plus, Loader2, FolderKanban } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";

type Project = {
  id: string;
  name: string;
  description: string | null;
  issuePrefix: string | null;
  healthStatus: string | null;
};

const HEALTH_BADGE: Record<string, string> = {
  on_track: "bg-emerald-100 text-emerald-700",
  at_risk: "bg-amber-100 text-amber-700",
  off_track: "bg-red-100 text-red-700",
};

export default function PmsHomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [pmsEnabled, setPmsEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [issuePrefix, setIssuePrefix] = useState("");

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
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, issuePrefix }),
      });
      if (!res.ok) throw new Error();
      const project = await res.json();
      toast.success("Project created");
      setOpen(false);
      setName("");
      setIssuePrefix("");
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
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
