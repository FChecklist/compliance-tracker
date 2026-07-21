"use client";

export const dynamic = "force-dynamic";

// Wave 3 (2026-07-21): first standalone Contacts page -- contacts
// previously only existed nested inside an account's own detail page, no
// way to browse the whole org's contact book in one place (real gap at
// 100-employee/500-project scale, same rationale as Wave 3's other pages).
// Account name is resolved client-side against the already-small accounts
// list (this repo's schema has no defined Drizzle relations() to join
// server-side without a larger, riskier schema change -- out of scope for
// this wave).
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Users, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Contact = { id: string; accountId: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean };
type Account = { id: string; name: string };

export default function CrmContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) params.set("search", search.trim());
    const [contactsRes, accountsRes] = await Promise.all([
      fetch(`/api/crm/contacts?${params.toString()}`),
      fetch("/api/crm/accounts?pageSize=200"),
    ]);
    const contactsData = await contactsRes.json();
    setContacts(contactsData.items ?? []);
    setTotal(contactsData.total ?? 0);
    const accountsData = await accountsRes.json();
    setAccounts(accountsData.items ?? []);
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  const accountName = (accountId: string) => accounts.find((a) => a.id === accountId)?.name ?? "Unknown account";
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Contacts</h1>
        <p className="text-sm text-ct-muted mt-1">Every named person across your account book -- add new contacts from an account's own page.</p>
      </div>

      <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search contacts by name..." className="max-w-sm" />

      {loading ? <p className="text-sm text-ct-muted">Loading...</p> : contacts.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><Users className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No contacts yet.</p></CardContent></Card>
      ) : (
        <>
          <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
            {contacts.map((c) => (
              <Link key={c.id} href={`/crm/accounts/${c.accountId}`} className="px-4 py-3 flex items-center gap-3 hover:bg-ct-cloud/40">
                <Users className="size-4 text-ct-saffron shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ct-navy">{c.name} {c.isPrimary && <Badge variant="outline" className="text-[10px] ml-1">Primary</Badge>}</p>
                  <p className="text-xs text-ct-muted">{c.title ?? "No title"} · {accountName(c.accountId)}</p>
                </div>
                <div className="text-xs text-ct-muted text-right">
                  {c.email && <p>{c.email}</p>}
                  {c.phone && <p>{c.phone}</p>}
                </div>
              </Link>
            ))}
          </div>
          <div className="flex items-center justify-between text-xs text-ct-muted">
            <span>{total} contact{total === 1 ? "" : "s"} total</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 px-2" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="size-3.5" /></Button>
              <span>Page {page} of {totalPages}</span>
              <Button size="sm" variant="outline" className="h-7 px-2" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="size-3.5" /></Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
