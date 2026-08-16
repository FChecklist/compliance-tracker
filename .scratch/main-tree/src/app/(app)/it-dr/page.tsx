"use client";

export const dynamic = "force-dynamic";

// Wave 92 (Comparison CSV 3 gap analysis: GRC009 "Disaster Recovery").
// Deliberately distinct from /bcm (Wave 89): BCM models generic business-
// process recovery narrative; this models IT-system-specific recovery --
// RTO/RPO per system, backup verification history, failover test history.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { ServerCrash, Plus, Loader2 } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type DrPlan = { id: string; systemName: string; criticalityLevel: string; rtoHours: string; rpoHours: string; backupFrequency: string; status: string };

const CRITICALITY_VARIANT: Record<string, "default" | "secondary" | "outline"> = { low: "outline", medium: "secondary", high: "default", critical: "default" };

export default function ItDrPage() {
  const [plans, setPlans] = useState<DrPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [systemName, setSystemName] = useState("");
  const [criticalityLevel, setCriticalityLevel] = useState("medium");
  const [rtoHours, setRtoHours] = useState("");
  const [rpoHours, setRpoHours] = useState("");
  const [backupFrequency, setBackupFrequency] = useState("daily");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/it-dr");
    setPlans((await res.json()).plans ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createPlan() {
    if (!systemName.trim() || !rtoHours || !rpoHours) { toast.error("System name, RTO, and RPO are required"); return; }
    setCreating(true);
    const res = await fetch("/api/it-dr", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemName, criticalityLevel, rtoHours: Number(rtoHours), rpoHours: Number(rpoHours), backupFrequency }),
    });
    setCreating(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to create DR plan"); return; }
    toast.success("DR plan created");
    setDialogOpen(false);
    setSystemName(""); setRtoHours(""); setRpoHours("");
    load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><ServerCrash className="w-6 h-6" />IT Disaster Recovery</h1>
        <p className="text-sm text-ct-muted mt-1">System-specific recovery objectives — RTO/RPO, backup verification, and failover test history.</p>
      </div>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <>
          <div className="flex justify-end mb-2">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal/90"><Plus className="w-4 h-4 mr-1" />New DR Plan</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New IT Disaster Recovery Plan</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>System Name</Label><Input value={systemName} onChange={(e) => setSystemName(e.target.value)} placeholder="e.g. Core ERP Database" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>RTO (hours)</Label><Input type="number" value={rtoHours} onChange={(e) => setRtoHours(e.target.value)} /></div>
                    <div><Label>RPO (hours)</Label><Input type="number" value={rpoHours} onChange={(e) => setRpoHours(e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Criticality</Label>
                      <Select value={criticalityLevel} onValueChange={setCriticalityLevel}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Backup Frequency</Label>
                      <Select value={backupFrequency} onValueChange={setBackupFrequency}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <DialogFooter><Button onClick={createPlan} disabled={creating}>{creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Plan"}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">System</th><th className="p-3 font-medium">RTO</th><th className="p-3 font-medium">RPO</th><th className="p-3 font-medium">Backup</th><th className="p-3 font-medium">Criticality</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {plans.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-ct-muted">No DR plans yet.</td></tr>
                    : plans.map((p) => (
                      <tr key={p.id} className="hover:bg-ct-row-hover cursor-pointer">
                        <td className="p-3"><Link href={`/it-dr/${p.id}`} className="text-ct-navy hover:underline">{p.systemName}</Link></td>
                        <td className="p-3">{p.rtoHours}h</td>
                        <td className="p-3">{p.rpoHours}h</td>
                        <td className="p-3">{p.backupFrequency}</td>
                        <td className="p-3"><Badge variant={CRITICALITY_VARIANT[p.criticalityLevel] ?? "outline"}>{p.criticalityLevel}</Badge></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
