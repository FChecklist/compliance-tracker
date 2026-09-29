"use client";

export const dynamic = "force-dynamic";

// PROJEXA server-merge -- port of PROJEXA's CandidateCreateClient.tsx. No
// Object Page -- candidates are simple master data, no get/update function
// exists (same as the source).
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function NewCandidatePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    if (!name.trim() || !email.trim()) { toast.error("Name and email are required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/recruitment/candidates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone: phone || undefined, source: source || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't add candidate");
      toast.success("Candidate added");
      router.push("/px/recruitment?tab=candidates");
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't add candidate");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Link href="/px/recruitment?tab=candidates" className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ArrowLeft className="size-3.5" /> Back to Recruitment
      </Link>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Add Candidate</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Phone (optional)</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Source (optional)</Label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. LinkedIn" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => router.push("/px/recruitment?tab=candidates")}>Cancel</Button>
            <Button
              onClick={create}
              disabled={submitting || !name.trim() || !email.trim()}
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
            >
              {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
