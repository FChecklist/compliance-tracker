"use client";

import { useEffect, useState } from "react";
import { Building2, FileText, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type ClientEntity = {
  id: string;
  legalName: string;
  entityType: string | null;
  gstin: string | null;
  pan: string | null;
  cin: string | null;
};

type Client = {
  id: string;
  name: string;
  isSelf: boolean;
  isActive: boolean;
  entities: ClientEntity[];
  createdAt: string;
};

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = () => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => {
        setClients(d.clients ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(load, []);

  const addClient = async () => {
    const name = window.prompt("Client name:");
    if (!name?.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) load();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Clients</h1>
          <p className="text-sm text-ct-muted mt-1">
            {clients.length} client{clients.length === 1 ? "" : "s"} served through this account
          </p>
        </div>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={addClient}
          disabled={creating}
        >
          <Plus className="size-4 mr-2" />
          Add Client
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="rounded-xl">
              <CardContent className="p-5">
                <Skeleton className="h-5 w-32 mb-2" />
                <Skeleton className="h-4 w-48" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {clients.map((client) => (
            <Card key={client.id} className="rounded-xl shadow-card bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-xl bg-ct-accent flex items-center justify-center">
                    <Building2 className="size-5 text-ct-saffron" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-heading text-ct-navy">
                      {client.name}
                    </CardTitle>
                    {client.isSelf && (
                      <Badge className="mt-0.5 bg-ct-accent text-ct-saffron border-0 text-[10px]">Self</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-ct-muted mb-2 flex items-center gap-1.5">
                  <FileText className="size-3.5" />
                  {client.entities.length} legal {client.entities.length === 1 ? "entity" : "entities"}
                </p>
                <div className="space-y-1.5">
                  {client.entities.map((e) => (
                    <div key={e.id} className="text-xs border-t border-ct-border pt-1.5">
                      <p className="text-ct-navy font-medium">{e.legalName}</p>
                      <p className="text-ct-muted">
                        {[e.entityType, e.gstin && `GSTIN: ${e.gstin}`, e.pan && `PAN: ${e.pan}`]
                          .filter(Boolean)
                          .join(" · ") || "No registration details on file"}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
