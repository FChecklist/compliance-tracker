"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own EmployeeCreateClient.tsx (src/app/(app)/employees/new/
// page.tsx there). POSTs to the already-native POST /api/v1/projexa/
// employees -- hr-service.ts has no "createEmployee": a user row is
// provisioned via auth/onboarding, not HR, so this screen sets/updates the
// employee PROFILE (job title, employment type, dates, ...) for an already
// -existing user, picked from the same /api/v1/projexa/employees list this
// module's own directory tab reads (confirmed by reading that route's own
// header comment before writing this file).
//
// UI is compliance-tracker's own shadcn Card/Input/Select (matching
// src/app/(app)/vendors/new/page.tsx's own conventions), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen.
//
// dateOfBirth is a real, accepted field on this same POST route
// (upsertEmployeeProfile's EmployeeProfileInput) that PROJEXA's own
// reference screen never captured either -- omitted here too, for parity
// with the page being ported rather than silently growing its scope.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Employee = { id: string; name: string | null; email: string };
type Company = { id: string; companyName: string; abbr: string | null };

export default function EmployeeNewPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [userId, setUserId] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("active");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [companyId, setCompanyId] = useState("__none__");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/employees").then((r) => r.json()).then((d) => setEmployees(d.employees ?? [])).catch(() => {});
    fetch("/api/v1/projexa/companies").then((r) => r.json()).then((d) => setCompanies(d.companies ?? [])).catch(() => {});
  }, []);

  async function createProfile() {
    if (!userId) { toast.error("Select a user"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/employees", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId, employeeCode: employeeCode || undefined, jobTitle: jobTitle || undefined,
          employmentType, dateOfJoining: dateOfJoining || undefined, employmentStatus,
          emergencyContactName: emergencyContactName || undefined, emergencyContactPhone: emergencyContactPhone || undefined,
          companyId: companyId === "__none__" ? undefined : companyId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't save employee profile");
      toast.success("Employee profile saved");
      router.push(`/employees/${userId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save employee profile");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Employee Profile</h1>
        <p className="text-sm text-ct-muted mt-1">Employees / Employee Profile</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white max-w-2xl">
        <CardHeader><CardTitle className="text-base text-ct-navy">Create / update employee profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">User</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="Select existing user account" /></SelectTrigger>
              <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name ? `${e.name} (${e.email})` : e.email}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Employee Code (optional)</Label><Input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Designation (optional)</Label><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Site Architect" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Employment Type</Label>
              <Select value={employmentType} onValueChange={setEmploymentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full Time</SelectItem>
                  <SelectItem value="part_time">Part Time</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                  <SelectItem value="intern">Intern</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Date of Joining (optional)</Label><Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Employment Status</Label>
            <Select value={employmentStatus} onValueChange={setEmploymentStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="on_leave">On Leave</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
                <SelectItem value="resigned">Resigned</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Emergency Contact Name (optional)</Label><Input value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Emergency Contact Phone (optional)</Label><Input value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} /></div>
          </div>
          {companies.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Company / Office (optional)</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unattributed</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="text-xs text-ct-muted">Department and reporting manager are managed from user administration, not here.</p>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => router.push("/employees")}>Cancel</Button>
            <Button
              onClick={() => void createProfile()}
              disabled={submitting || !userId}
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
            >
              {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
