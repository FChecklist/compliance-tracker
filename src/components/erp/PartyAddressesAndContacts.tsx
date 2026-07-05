"use client";

// Wave 84 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #5): shared between the
// customer and supplier detail pages -- addresses/contacts are polymorphic
// (erp-party-service.ts), so this is one component, not a customer-only and
// supplier-only copy of the same ~100 lines of dialog/list UI.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, MapPin, User, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Address = { id: string; addressType: string; line1: string; line2: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null; isPrimary: boolean };
type Contact = { id: string; contactName: string; designation: string | null; email: string | null; phone: string | null; isPrimary: boolean };

export function PartyAddressesAndContacts({ entityType, entityId }: { entityType: "erp_customer" | "erp_supplier"; entityId: string }) {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const [addrOpen, setAddrOpen] = useState(false);
  const [addrType, setAddrType] = useState<"billing" | "shipping" | "other">("billing");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [addrPrimary, setAddrPrimary] = useState(false);
  const [savingAddr, setSavingAddr] = useState(false);

  const [contactOpen, setContactOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [designation, setDesignation] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [contactPrimary, setContactPrimary] = useState(false);
  const [savingContact, setSavingContact] = useState(false);

  const load = useCallback(async () => {
    const [addrRes, contactRes] = await Promise.all([
      fetch(`/api/erp/parties/${entityType}/${entityId}/addresses`),
      fetch(`/api/erp/parties/${entityType}/${entityId}/contacts`),
    ]);
    const [addrData, contactData] = await Promise.all([addrRes.json(), contactRes.json()]);
    setAddresses(addrData.addresses ?? []);
    setContacts(contactData.contacts ?? []);
    setLoading(false);
  }, [entityType, entityId]);

  useEffect(() => { load(); }, [load]);

  const addAddress = async () => {
    setSavingAddr(true);
    try {
      const res = await fetch(`/api/erp/parties/${entityType}/${entityId}/addresses`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addressType: addrType, line1, line2: line2 || undefined, city: city || undefined, state: stateVal || undefined, postalCode: postalCode || undefined, country: country || undefined, isPrimary: addrPrimary }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Address added");
      setAddrOpen(false); setLine1(""); setLine2(""); setCity(""); setStateVal(""); setPostalCode(""); setCountry(""); setAddrPrimary(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add address");
    } finally {
      setSavingAddr(false);
    }
  };

  const removeAddress = async (id: string) => {
    const res = await fetch(`/api/erp/parties/${entityType}/${entityId}/addresses/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to delete address"); return; }
    toast.success("Address removed");
    load();
  };

  const addContact = async () => {
    setSavingContact(true);
    try {
      const res = await fetch(`/api/erp/parties/${entityType}/${entityId}/contacts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactName, designation: designation || undefined, email: email || undefined, phone: phone || undefined, isPrimary: contactPrimary }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("Contact added");
      setContactOpen(false); setContactName(""); setDesignation(""); setEmail(""); setPhone(""); setContactPrimary(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add contact");
    } finally {
      setSavingContact(false);
    }
  };

  const removeContact = async (id: string) => {
    const res = await fetch(`/api/erp/parties/${entityType}/${entityId}/contacts/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to delete contact"); return; }
    toast.success("Contact removed");
    load();
  };

  if (loading) return null;

  return (
    <>
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base text-ct-navy flex items-center gap-2"><MapPin className="size-4 text-ct-teal" /> Addresses</CardTitle>
          <Dialog open={addrOpen} onOpenChange={setAddrOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="size-3.5 mr-1" /> Add</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Address</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div><Label>Type</Label>
                  <Select value={addrType} onValueChange={(v) => setAddrType(v as typeof addrType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="billing">Billing</SelectItem><SelectItem value="shipping">Shipping</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>Address Line 1</Label><Input value={line1} onChange={(e) => setLine1(e.target.value)} /></div>
                <div><Label>Address Line 2 (optional)</Label><Input value={line2} onChange={(e) => setLine2(e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>City</Label><Input value={city} onChange={(e) => setCity(e.target.value)} /></div>
                  <div><Label>State</Label><Input value={stateVal} onChange={(e) => setStateVal(e.target.value)} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Postal Code</Label><Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} /></div>
                  <div><Label>Country</Label><Input value={country} onChange={(e) => setCountry(e.target.value)} /></div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={addrPrimary} onChange={(e) => setAddrPrimary(e.target.checked)} />
                  <Label className="!mb-0">Set as primary</Label>
                </div>
              </div>
              <DialogFooter><Button onClick={addAddress} disabled={savingAddr || !line1} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{savingAddr && <Loader2 className="size-4 mr-1.5 animate-spin" />}Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-2">
          {addresses.length === 0 ? <p className="text-xs text-ct-muted">No addresses on file.</p> : addresses.map((a) => (
            <div key={a.id} className="text-sm border border-ct-border rounded-lg px-3 py-2 flex items-center justify-between">
              <div>
                <p className="font-medium text-ct-navy">{a.line1}{a.line2 ? `, ${a.line2}` : ""}</p>
                <p className="text-xs text-ct-muted">{[a.city, a.state, a.postalCode, a.country].filter(Boolean).join(", ")} · {a.addressType}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {a.isPrimary && <Badge variant="outline" className="text-xs">Primary</Badge>}
                <Button size="sm" variant="ghost" onClick={() => removeAddress(a.id)}><Trash2 className="size-3.5" /></Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base text-ct-navy flex items-center gap-2"><User className="size-4 text-ct-teal" /> Contacts</CardTitle>
          <Dialog open={contactOpen} onOpenChange={setContactOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="size-3.5 mr-1" /> Add</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div><Label>Contact Name</Label><Input value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
                <div><Label>Designation (optional)</Label><Input value={designation} onChange={(e) => setDesignation(e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                  <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={contactPrimary} onChange={(e) => setContactPrimary(e.target.checked)} />
                  <Label className="!mb-0">Set as primary</Label>
                </div>
              </div>
              <DialogFooter><Button onClick={addContact} disabled={savingContact || !contactName} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{savingContact && <Loader2 className="size-4 mr-1.5 animate-spin" />}Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-2">
          {contacts.length === 0 ? <p className="text-xs text-ct-muted">No contacts on file.</p> : contacts.map((c) => (
            <div key={c.id} className="text-sm border border-ct-border rounded-lg px-3 py-2 flex items-center justify-between">
              <div>
                <p className="font-medium text-ct-navy">{c.contactName}{c.designation ? ` · ${c.designation}` : ""}</p>
                <p className="text-xs text-ct-muted">{[c.email, c.phone].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {c.isPrimary && <Badge variant="outline" className="text-xs">Primary</Badge>}
                <Button size="sm" variant="ghost" onClick={() => removeContact(c.id)}><Trash2 className="size-3.5" /></Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
