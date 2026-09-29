"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own DepartmentCreateClient.tsx (src/app/(app)/employees/
// departments/new/page.tsx there). POSTs to the already-native POST
// /api/v1/projexa/hr/departments -- create-only, no dedicated department
// service module exists anywhere in this codebase (that route's own header
// comment: it queries the `departments` table directly, matching the
// platform's own /api/departments route 1:1). No update/delete endpoint
// exists either, matching PROJEXA's own reference page's honest scope cut
// ("no Object Page: hr-department creation has no update/delete backend at
// all") -- this port carries the same limitation, not a new one.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function DepartmentNewPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createDepartment() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/hr/departments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't create department");
      toast.success("Department created");
      router.push("/employees?tab=departments");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create department");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Department</h1>
        <p className="text-sm text-ct-muted mt-1">Employees / New Department</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white max-w-2xl">
        <CardHeader><CardTitle className="text-base text-ct-navy">Department details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => router.push("/employees?tab=departments")}>Cancel</Button>
            <Button
              onClick={() => void createDepartment()}
              disabled={submitting || !name.trim()}
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
            >
              {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Create Department
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
