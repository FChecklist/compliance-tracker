"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge module 21/24 (GRC): port of PROJEXA's own
// PolicyCreateClient.tsx (src/app/(app)/grc/policies/new/page.tsx there).
// POSTs to the already-live POST /api/v1/projexa/policies (createPolicy in
// risk-register-service.ts) -- zero new backend route. Requires
// requireRoleOrScope(ctx, "member", "write").
//
// UI is compliance-tracker's own shadcn Card/Input/Select (house convention).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = ["governance", "hr", "environment", "data_privacy", "third_party", "sop"];

export default function PolicyNewPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("governance");
  const [submitting, setSubmitting] = useState(false);

  async function createPolicy() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), category }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to draft policy");
      toast.success("Policy drafted");
      router.push(`/grc/policies/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't draft policy");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Draft Policy</h1>
        <p className="text-sm text-ct-muted mt-1">GRC / Policies / New</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Policy Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={submitting} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Category</Label>
            <Select value={category} onValueChange={setCategory} disabled={submitting}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c.replace("_", " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/grc?tab=policies")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={createPolicy}
          disabled={submitting || !title.trim()}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Drafting…" : "Draft Policy"}
        </Button>
      </div>
    </div>
  );
}
