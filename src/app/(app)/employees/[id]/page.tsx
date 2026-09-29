"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own EmployeeObjectClient.tsx (src/app/(app)/employees/[id]/
// page.tsx there). Reads/writes the already-native GET/PATCH
// /api/v1/projexa/employees/[id] -- a thin alias over hr-service.ts's
// listEmployees/upsertEmployeeProfile, zero new backend route.
//
// UI is compliance-tracker's own shadcn Card/Input/Select (matching
// src/app/(app)/vendors/[id]/page.tsx's own conventions), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen. useParams() is used for the
// dynamic segment (a plain, synchronous client-side read), matching every
// other already-ported dynamic-segment page in this repo
// (src/app/(app)/vendors/[id]/page.tsx, .../budgets/[id]/page.tsx,
// .../purchase-orders/[id]/page.tsx) rather than an async server-component
// wrapper.
//
// Real, honest gap carried over from PROJEXA's own reference page (its own
// header comment: "Known, pre-existing limitation... upsertEmployeeProfile()
// requires a real VERIDIAN user session"): PATCH /api/v1/projexa/employees/
// [id] refuses an API-key-only caller (ctx.dbUser required) -- irrelevant
// here since this page always runs under a real signed-in session, unlike
// PROJEXA's own Bearer-key proxy.
//
// A second, separate gap found while reading the real route (not present in
// PROJEXA's own reference page, which never surfaced it either):
// PATCH /api/v1/projexa/employees/[id]/route.ts's own body destructuring
// omits companyId (only POST /api/v1/projexa/employees accepts it, at
// profile-creation time) -- confirmed by reading that file directly before
// writing this one. Company is therefore rendered read-only here, in both
// display and edit mode; no edit control is offered for a field the server
// would silently ignore.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type EmployeeProfile = {
  employeeCode: string | null;
  jobTitle: string | null;
  employmentType: string | null;
  dateOfJoining: string | null;
  employmentStatus: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  companyId: string | null;
};
type Employee = {
  id: string; name: string | null; email: string; role: string;
  departmentId: string | null; reportingToId: string | null; profile: EmployeeProfile | null;
};
type Department = { id: string; name: string };
type Company = { id: string; companyName: string; abbr: string | null };

const EMPLOYMENT_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default", on_leave: "secondary", terminated: "destructive", resigned: "outline",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

async function fetchJsonOr<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const employeeId = params.id;
  const router = useRouter();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [saving, setSaving] = useState(false);

  const [employeeCode, setEmployeeCode] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("active");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");

  function seedForm(e: Employee) {
    setEmployeeCode(e.profile?.employeeCode ?? "");
    setJobTitle(e.profile?.jobTitle ?? "");
    setEmploymentType(e.profile?.employmentType ?? "full_time");
    setDateOfJoining(e.profile?.dateOfJoining ? e.profile.dateOfJoining.slice(0, 10) : "");
    setEmploymentStatus(e.profile?.employmentStatus ?? "active");
    setEmergencyContactName(e.profile?.emergencyContactName ?? "");
    setEmergencyContactPhone(e.profile?.emergencyContactPhone ?? "");
  }

  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/employees/${employeeId}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Couldn't load this employee (HTTP ${res.status})`);
      const [deptData, empData, coData] = await Promise.all([
        fetchJsonOr<{ departments?: Department[] }>("/api/v1/projexa/hr/departments", { departments: [] }),
        fetchJsonOr<{ employees?: Employee[] }>("/api/v1/projexa/employees", { employees: [] }),
        fetchJsonOr<{ companies?: Company[] }>("/api/v1/projexa/companies", { companies: [] }),
      ]);
      setEmployee(body);
      seedForm(body);
      setDepartments(deptData.departments ?? []);
      setEmployees(empData.employees ?? []);
      setCompanies(coData.companies ?? []);
      setLoadError(null);
    } catch (err) {
      setEmployee(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this employee");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { void load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/projexa/employees/${employeeId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeCode: employeeCode || undefined, jobTitle: jobTitle || undefined, employmentType,
          dateOfJoining: dateOfJoining || undefined, employmentStatus,
          emergencyContactName: emergencyContactName || undefined, emergencyContactPhone: emergencyContactPhone || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't save employee profile");
      toast.success("Employee profile saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save employee profile");
    } finally {
      setSaving(false);
    }
  }

  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";
  const employeeName = (id: string | null) => {
    const e = employees.find((emp) => emp.id === id);
    return e?.name ?? e?.email ?? "—";
  };
  const companyName = (id: string | null | undefined) => {
    if (!id) return "—";
    const c = companies.find((co) => co.id === id);
    return c ? `${c.abbr ? `${c.abbr} — ` : ""}${c.companyName}` : "—";
  };

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-ct-muted" /></div>;
  }
  if (loadError || !employee) {
    return (
      <div className="space-y-3">
        <button onClick={() => router.push("/employees")} className="inline-flex items-center gap-1 text-xs text-ct-muted hover:underline">
          <ArrowLeft className="size-3.5" /> Employees
        </button>
        <p role="alert" className="text-sm text-ct-error">{loadError ?? "Employee not found"}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <button onClick={() => router.push("/employees")} className="inline-flex items-center gap-1 text-xs text-ct-muted hover:underline mb-1">
            <ArrowLeft className="size-3.5" /> Employees
          </button>
          <h1 className="text-2xl font-heading text-ct-navy flex items-center gap-2">
            {employee.name ?? employee.email}
            {employee.profile?.employmentStatus && (
              <Badge variant={EMPLOYMENT_STATUS_VARIANT[employee.profile.employmentStatus] ?? "outline"}>
                {employee.profile.employmentStatus.replace(/_/g, " ")}
              </Badge>
            )}
          </h1>
          <p className="text-sm text-ct-muted mt-1">{employee.email}</p>
        </div>
        <div className="flex items-center gap-2">
          {mode === "display" ? (
            <Button variant="outline" onClick={() => { seedForm(employee); setMode("edit"); }}>Edit</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => { seedForm(employee); setMode("display"); }}>Cancel</Button>
              <Button onClick={() => void handleSave()} disabled={saving} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Save
              </Button>
            </>
          )}
        </div>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="pt-6 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div><p className="text-xs text-ct-muted uppercase">Department</p><p className="text-ct-navy">{departmentName(employee.departmentId)}</p></div>
          <div><p className="text-xs text-ct-muted uppercase">Reports To</p><p className="text-ct-navy">{employeeName(employee.reportingToId)}</p></div>
          <div><p className="text-xs text-ct-muted uppercase">Company</p><p className="text-ct-navy">{companyName(employee.profile?.companyId)}</p></div>
        </CardContent>
      </Card>

      {mode === "edit" ? (
        <Card className="rounded-xl shadow-card bg-white max-w-2xl">
          <CardHeader><CardTitle className="text-base text-ct-navy">Employee profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Employee Code</Label><Input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Designation</Label><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Site Architect" /></div>
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
              <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Date of Joining</Label><Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} /></div>
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
              <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Emergency Contact Name</Label><Input value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Emergency Contact Phone</Label><Input value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} /></div>
            </div>
            <p className="text-xs text-ct-muted">Department and reporting manager are managed from user administration, not here. Company can only be set when the profile is first created.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Profile</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div><dt className="text-xs text-ct-muted uppercase">Employee Code</dt><dd className="text-ct-navy">{employee.profile?.employeeCode ?? "—"}</dd></div>
                <div><dt className="text-xs text-ct-muted uppercase">Designation</dt><dd className="text-ct-navy">{employee.profile?.jobTitle ?? "—"}</dd></div>
                <div><dt className="text-xs text-ct-muted uppercase">Employment Type</dt><dd className="text-ct-navy">{employee.profile?.employmentType?.replace(/_/g, " ") ?? "—"}</dd></div>
                <div><dt className="text-xs text-ct-muted uppercase">Joined</dt><dd className="text-ct-navy">{employee.profile?.dateOfJoining ? formatDate(employee.profile.dateOfJoining) : "—"}</dd></div>
              </dl>
            </CardContent>
          </Card>
          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Emergency Contact</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-xs text-ct-muted uppercase">Name</dt><dd className="text-ct-navy">{employee.profile?.emergencyContactName ?? "—"}</dd></div>
                <div><dt className="text-xs text-ct-muted uppercase">Phone</dt><dd className="text-ct-navy">{employee.profile?.emergencyContactPhone ?? "—"}</dd></div>
              </dl>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
