"use client";

export const dynamic = "force-dynamic";

// VERIDIAN Review Framework Wave B (2026-07-17): crm_leads/crm_opportunities
// (Wave 41) never had a persistent company-level "account" record -- this
// is the first management surface for the new crm_accounts/crm_contacts
// tables, list+detail shape mirroring /erp/customers (the closest existing
// "company master record" precedent) but with real search/filter/pagination
// since a 100-employee/500-project firm's account book won't fit in one
// unpaginated fetch the way the leads/opportunities tab page still does.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Building2, Loader2, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

type Account = {
  id: string; name: string; industry: string | null; website: string | null;
  lifecycleStage: string; ownerId: string | null; parentAccountId: string | null;
};
type User = { id: string; name: string };

const LIFECYCLE_COLORS: Record<string, string> = {
  prospect: "bg-ct-cloud text-ct-muted",
  active_client: "bg-green-100 text-green-700",
  dormant: "bg-ct-saffron/20 text-ct-saffron",
  churned: "bg-red-100 text-red-700",
};

const LIFECYCLE_LABELS: Record<string, string> = {
  prospect: "Prospect", active_client: "Active Client", dormant: "Dormant", churned: "Churned",
};

export default function CrmAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [parentAccountId, setParentAccountId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) params.set("search", search.trim());
    if (lifecycleFilter !== "all") params.set("lifecycleStage", lifecycleFilter);
    const res = await fetch(`/api/crm/accounts?${params.toString()}`);
    const data = await res.json();
    setAccounts(data.items ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, [page, search, lifecycleFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d) => setUsers(d.users ?? []));
  }, []);

  const createAccount = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/crm/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, industry: industry || undefined, website: website || undefined,
          ownerId: ownerId || undefined, parentAccountId: parentAccountId || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Account created");
      setOpen(false);
      setName(""); setIndustry(""); setWebsite(""); setOwnerId(""); setParentAccountId("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setCreating(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Accounts</h1>
          <p className="text-sm text-ct-muted mt-1">Company-level records -- industry, address, lifecycle stage, and subsidiary hierarchy, with contacts underneath each one.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"><Plus className="w-4 h-4 mr-1" />New Account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Account</DialogTitle><DialogDescription>A company-level record -- add contacts once it's created.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Retail Pvt Ltd" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Industry (optional)</Label>
                  <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Retail" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Website (optional)</Label>
                  <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="acme.com" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Owner (optional)</Label>
                <Select value={ownerId} onValueChange={setOwnerId}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Parent Account (optional)</Label>
                <Select value={parentAccountId} onValueChange={setParentAccountId}>
                  <SelectTrigger><SelectValue placeholder="None -- top-level account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createAccount} disabled={creating || !name.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create Account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-3">
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search accounts by name..."
          className="max-w-sm"
        />
        <Select value={lifecycleFilter} onValueChange={(v) => { setLifecycleFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            <SelectItem value="prospect">Prospect</SelectItem>
            <SelectItem value="active_client">Active Client</SelectItem>
            <SelectItem value="dormant">Dormant</SelectItem>
            <SelectItem value="churned">Churned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? <p className="text-sm text-ct-muted">Loading...</p> : accounts.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><Building2 className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No accounts yet.</p></CardContent></Card>
      ) : (
        <>
          <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
            {accounts.map((a) => (
              <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                <Building2 className="size-4 text-ct-saffron shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ct-navy">{a.name}</p>
                  <p className="text-xs text-ct-muted">
                    {a.industry ?? "No industry set"}
                    {a.parentAccountId ? " · Subsidiary" : ""}
                  </p>
                </div>
                <Badge className={`text-xs border-0 ${LIFECYCLE_COLORS[a.lifecycleStage] ?? "bg-ct-cloud text-ct-muted"}`}>
                  {LIFECYCLE_LABELS[a.lifecycleStage] ?? a.lifecycleStage}
                </Badge>
                <Link href={`/crm/accounts/${a.id}`}>
                  <Button size="sm" variant="outline" className="h-8 text-xs">Manage</Button>
                </Link>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between text-xs text-ct-muted">
            <span>{total} account{total === 1 ? "" : "s"} total</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 px-2" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="size-3.5" />
              </Button>
              <span>Page {page} of {totalPages}</span>
              <Button size="sm" variant="outline" className="h-7 px-2" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
