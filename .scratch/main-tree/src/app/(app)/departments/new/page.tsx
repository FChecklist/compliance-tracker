"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function NewDepartmentPage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Department name is required");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error);
      }

      toast.success("Department created!");
      router.push("/departments");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create department");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <Link
        href="/departments"
        className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition"
      >
        <ArrowLeft className="size-4" />
        Back to Departments
      </Link>

      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">New Department</h1>
        <p className="text-sm text-ct-muted mt-1">Create a new department for your organisation</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader>
          <CardTitle className="text-base text-ct-navy">Department Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs font-semibold text-ct-muted uppercase">
                Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="name"
                placeholder="e.g. Finance & Accounts"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description" className="text-xs font-semibold text-ct-muted uppercase">
                Description
              </Label>
              <Textarea
                id="description"
                placeholder="Brief description of this department's compliance responsibilities..."
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button
          type="button"
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          disabled={submitting}
          onClick={() => formRef.current?.requestSubmit()}
        >
          {submitting ? "Creating..." : "Create Department"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/departments")}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
