"use client";

export const dynamic = "force-dynamic";

// VERIDIAN Review Framework Wave B (2026-07-17): account detail page --
// profile edit, billing/shipping address, contacts roster (primary-contact
// aware), linked leads/opportunities, and child accounts (subsidiaries).
// Mirrors /erp/customers/[id]'s list+detail shape, extended with the
// contacts-roster + hierarchy views this entity actually needs at
// 100-employee/500-project scale.
import { useEffect, useState, useCallback, use as usePromise } from "react";
import { toast } from "sonner";
import Link from "next/link";
import {
  ArrowLeft, Loader2, MapPin, Users, Target, UserPlus, Star, Trash2, Building2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

type Account = {
  id: string; name: string; industry: string | null; website: string | null;
  lifecycleStage: string; ownerId: string | null; parentAccountId: string | null;
  billingLine1: string | null; billingLine2: string | null; billingCity: string | null;
  billingState: string | null; billingPostalCode: string | null; billingCountry: string | null;
  shippingSameAsBilling: boolean;
  shippingLine1: string | null; shippingLine2: string | null; shippingCity: string | null;
  shippingState: string | null; shippingPostalCode: string | null; shippingCountry: string | null;
};
type Contact = { id: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean };
type Lead = { id: string; name: string; status: string };
type Opportunity = { id: string; name: string; stage: string; estimatedValue: string | null };
type ChildAccount = { id: string; name: string; lifecycleStage: string };
type User = { id: string; name: string };

const LIFECYCLE_LABELS: Record<string, string> = {
  prospect: "Prospect", active_client: "Active Client", dormant: "Dormant", churned: "Churned",
};

export default function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);

  const [account, setAccount] = useState<Account | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [childAccounts, setChildAccounts] = useState<ChildAccount[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [contactOpen, setContactOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactTitle, setContactTitle] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactPrimary, setContactPrimary] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/crm/accounts/${id}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    setAccount(data.account);
    setContacts(data.contacts ?? []);
    setLeads(data.leads ?? []);
    setOpportunities(data.opportunities ?? []);
    setChildAccounts(data.childAccounts ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d) => setUsers(d.users ?? []));
  }, []);

  const patchAccount = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/accounts/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Account updated");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update account");
    } finally {
      setSaving(false);
    }
  };

  const createContact = async () => {
    if (!contactName.trim()) return;
    setCreatingContact(true);
    try {
      const res = await fetch(`/api/crm/accounts/${id}/contacts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: contactName, title: contactTitle || undefined, email: contactEmail || undefined, phone: contactPhone || undefined, isPrimary: contactPrimary }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Contact added");
      setContactOpen(false);
      setContactName(""); setContactTitle(""); setContactEmail(""); setContactPhone(""); setContactPrimary(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add contact");
    } finally {
      setCreatingContact(false);
    }
  };

  const setPrimaryContact = async (contactId: string) => {
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isPrimary: true }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Failed to update primary contact");
    }
  };

  const deleteContact = async (contactId: string) => {
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Contact removed");
      load();
    } catch {
      toast.error("Failed to remove contact");
    }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!account) return <p className="text-sm text-ct-muted">Account not found.</p>;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/crm/accounts" className="text-xs text-ct-muted hover:text-ct-navy flex items-center gap-1 mb-2">
          <ArrowLeft className="size-3" /> Back to Accounts
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-heading text-ct-navy">{account.name}</h1>
          <Select value={account.lifecycleStage} onValueChange={(v) => patchAccount({ lifecycleStage: v })}>
            <SelectTrigger className="w-[150px] h-8 text-xs" disabled={saving}><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(LIFECYCLE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2"><CardTitle className="text-base text-ct-navy flex items-center gap-2"><Building2 className="size-4 text-ct-saffron" /> Profile</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-ct-muted">Industry</Label>
                <Input defaultValue={account.industry ?? ""} onBlur={(e) => e.target.value !== (account.industry ?? "") && patchAccount({ industry: e.target.value || null })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-ct-muted">Website</Label>
                <Input defaultValue={account.website ?? ""} onBlur={(e) => e.target.value !== (account.website ?? "") && patchAccount({ website: e.target.value || null })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-ct-muted">Owner</Label>
              <Select value={account.ownerId ?? ""} onValueChange={(v) => patchAccount({ ownerId: v })}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {childAccounts.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-ct-muted">Subsidiaries</Label>
                <div className="space-y-1">
                  {childAccounts.map((c) => (
                    <Link key={c.id} href={`/crm/accounts/${c.id}`} className="text-xs text-ct-teal hover:underline flex items-center gap-1">
                      <Building2 className="size-3" /> {c.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2"><CardTitle className="text-base text-ct-navy flex items-center gap-2"><MapPin className="size-4 text-ct-teal" /> Billing Address</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Input placeholder="Line 1" defaultValue={account.billingLine1 ?? ""} onBlur={(e) => e.target.value !== (account.billingLine1 ?? "") && patchAccount({ billingLine1: e.target.value || null })} />
            <Input placeholder="Line 2" defaultValue={account.billingLine2 ?? ""} onBlur={(e) => e.target.value !== (account.billingLine2 ?? "") && patchAccount({ billingLine2: e.target.value || null })} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="City" defaultValue={account.billingCity ?? ""} onBlur={(e) => e.target.value !== (account.billingCity ?? "") && patchAccount({ billingCity: e.target.value || null })} />
              <Input placeholder="State" defaultValue={account.billingState ?? ""} onBlur={(e) => e.target.value !== (account.billingState ?? "") && patchAccount({ billingState: e.target.value || null })} />
              <Input placeholder="Postal Code" defaultValue={account.billingPostalCode ?? ""} onBlur={(e) => e.target.value !== (account.billingPostalCode ?? "") && patchAccount({ billingPostalCode: e.target.value || null })} />
              <Input placeholder="Country" defaultValue={account.billingCountry ?? ""} onBlur={(e) => e.target.value !== (account.billingCountry ?? "") && patchAccount({ billingCountry: e.target.value || null })} />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Checkbox checked={account.shippingSameAsBilling} onCheckedChange={(v) => patchAccount({ shippingSameAsBilling: !!v })} id="same-as-billing" />
              <Label htmlFor="same-as-billing" className="text-xs text-ct-muted">Shipping address same as billing</Label>
            </div>
            {!account.shippingSameAsBilling && (
              <div className="space-y-2 pt-2 border-t border-ct-border">
                <p className="text-xs font-semibold text-ct-muted uppercase">Shipping Address</p>
                <Input placeholder="Line 1" defaultValue={account.shippingLine1 ?? ""} onBlur={(e) => e.target.value !== (account.shippingLine1 ?? "") && patchAccount({ shippingLine1: e.target.value || null })} />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="City" defaultValue={account.shippingCity ?? ""} onBlur={(e) => e.target.value !== (account.shippingCity ?? "") && patchAccount({ shippingCity: e.target.value || null })} />
                  <Input placeholder="State" defaultValue={account.shippingState ?? ""} onBlur={(e) => e.target.value !== (account.shippingState ?? "") && patchAccount({ shippingState: e.target.value || null })} />
                  <Input placeholder="Postal Code" defaultValue={account.shippingPostalCode ?? ""} onBlur={(e) => e.target.value !== (account.shippingPostalCode ?? "") && patchAccount({ shippingPostalCode: e.target.value || null })} />
                  <Input placeholder="Country" defaultValue={account.shippingCountry ?? ""} onBlur={(e) => e.target.value !== (account.shippingCountry ?? "") && patchAccount({ shippingCountry: e.target.value || null })} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base text-ct-navy flex items-center gap-2"><Users className="size-4 text-ct-saffron" /> Contacts</CardTitle>
          <Dialog open={contactOpen} onOpenChange={setContactOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline"><UserPlus className="size-3.5 mr-1" /> Add Contact</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Contact</DialogTitle><DialogDescription>A person at {account.name}.</DialogDescription></DialogHeader>
              <div className="space-y-3 py-2">
                <div><Label className="text-xs text-ct-muted">Name</Label><Input value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
                <div><Label className="text-xs text-ct-muted">Title (optional)</Label><Input value={contactTitle} onChange={(e) => setContactTitle(e.target.value)} placeholder="CFO" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs text-ct-muted">Email (optional)</Label><Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} /></div>
                  <div><Label className="text-xs text-ct-muted">Phone (optional)</Label><Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} /></div>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={contactPrimary} onCheckedChange={(v) => setContactPrimary(!!v)} id="is-primary" />
                  <Label htmlFor="is-primary" className="text-xs text-ct-muted">Primary contact</Label>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={createContact} disabled={creatingContact || !contactName.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                  {creatingContact ? <Loader2 className="size-4 mr-2 animate-spin" /> : null} Add Contact
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <p className="text-sm text-ct-muted text-center py-6">No contacts yet.</p>
          ) : (
            <div className="divide-y divide-ct-border">
              {contacts.map((c) => (
                <div key={c.id} className="py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ct-navy flex items-center gap-1.5">
                      {c.name}
                      {c.isPrimary && <Badge variant="outline" className="text-[10px] gap-1"><Star className="size-2.5 text-ct-saffron" /> Primary</Badge>}
                    </p>
                    <p className="text-xs text-ct-muted">{c.title ?? "No title"} {c.email ? `· ${c.email}` : ""} {c.phone ? `· ${c.phone}` : ""}</p>
                  </div>
                  {!c.isPrimary && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPrimaryContact(c.id)}>Make Primary</Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => deleteContact(c.id)}>
                    <Trash2 className="size-3.5 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2"><CardTitle className="text-base text-ct-navy flex items-center gap-2"><UserPlus className="size-4 text-ct-teal" /> Linked Leads</CardTitle></CardHeader>
          <CardContent>
            {leads.length === 0 ? <p className="text-xs text-ct-muted">No leads linked to this account.</p> : (
              <div className="space-y-1.5">
                {leads.map((l) => (
                  <div key={l.id} className="flex items-center justify-between text-sm">
                    <span className="text-ct-navy">{l.name}</span>
                    <Badge variant="outline" className="text-xs">{l.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="pb-2"><CardTitle className="text-base text-ct-navy flex items-center gap-2"><Target className="size-4 text-ct-teal" /> Linked Opportunities</CardTitle></CardHeader>
          <CardContent>
            {opportunities.length === 0 ? <p className="text-xs text-ct-muted">No opportunities linked to this account.</p> : (
              <div className="space-y-1.5">
                {opportunities.map((o) => (
                  <div key={o.id} className="flex items-center justify-between text-sm">
                    <span className="text-ct-navy">{o.name}</span>
                    <Badge variant="outline" className="text-xs">{o.stage}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
