"use client";

// Wave 6 batch 1 (compliance-tracker/PROJEXA merge): a tiny shared
// project-selector, factored out because site-diary, rfis, submittals,
// punch-list, scope, labour and expenses all need the exact same
// "choose a project, empty state if none exist" chrome and none of them is
// complex enough to justify six copies of the same 15 lines. Deliberately
// NOT a data-fetching hook -- callers own their own `projects` state so
// each page's loading/empty states stay under its own control.
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { LucideIcon } from "lucide-react";

export type PickerProject = { id: string; name: string };

export function ProjectPicker({ projects, value, onChange }: { projects: PickerProject[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="max-w-xs">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Choose a project" /></SelectTrigger>
        <SelectContent>
          {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function NoProjectsCard({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <Card className="rounded-xl shadow-card bg-white">
      <CardContent className="pt-10 pb-10 text-center space-y-2">
        <Icon className="size-10 text-ct-muted mx-auto" />
        <p className="text-sm text-ct-muted">No projects yet -- create a project first.</p>
      </CardContent>
    </Card>
  );
}
