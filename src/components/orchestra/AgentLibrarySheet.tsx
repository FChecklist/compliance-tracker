"use client";

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TIER_LABEL, type AgentTier } from "@/lib/orchestra-mock-data";

const TIERS: AgentTier[] = ["global", "firm", "client", "user"];

// Maps the DB's tier keys (customer-tier is stored as "customer", matching
// the master spec's "Customer Account" hierarchy naming) to the mock data's
// display tier keys (which use "firm", inherited from the original UI
// mockup). Only the label differs -- the underlying agent objects use the
// real "customer" tier value from the API.
const DB_TIER_TO_DISPLAY: Record<string, AgentTier> = {
  global: "global",
  customer: "firm",
  client: "client",
  user: "user",
};

type WorkerAgent = {
  id: string;
  tier: string;
  name: string;
  domain: string | null;
  description: string | null;
  isImmutable: boolean;
  version: number;
  usageCount: number;
  accuracyScore: string | null;
};

export function AgentLibrarySheet() {
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<WorkerAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/worker-agents")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setAgents(data.agents ?? []))
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Layers className="size-3.5" />
          Agent Library
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="border-b">
          <SheetTitle>Agent Library</SheetTitle>
          <SheetDescription>
            4 tiers · {agents.length} real worker agent{agents.length === 1 ? "" : "s"} (Wave 3 —
            live from <span className="font-mono">worker_agents</span>)
          </SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="global" className="flex-1 flex flex-col overflow-hidden gap-0">
          <TabsList className="mx-4 mt-2">
            {TIERS.map((tier) => (
              <TabsTrigger key={tier} value={tier} className="text-xs">
                {TIER_LABEL[tier]}
                <span className="ml-1 opacity-60">
                  {agents.filter((a) => DB_TIER_TO_DISPLAY[a.tier] === tier).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {TIERS.map((tier) => (
            <TabsContent key={tier} value={tier} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 mt-0">
              {loading ? (
                <>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </>
              ) : agents.filter((a) => DB_TIER_TO_DISPLAY[a.tier] === tier).length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No {TIER_LABEL[tier].toLowerCase()}-tier agents yet.
                </p>
              ) : (
                agents
                  .filter((a) => DB_TIER_TO_DISPLAY[a.tier] === tier)
                  .map((agent) => {
                    const accuracy = agent.accuracyScore !== null ? Number(agent.accuracyScore) : null;
                    return (
                      <div key={agent.id} className="rounded-lg border p-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">{agent.name}</span>
                          {agent.isImmutable && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0">
                              Immutable
                            </Badge>
                          )}
                        </div>
                        {agent.domain && (
                          <p className="text-xs text-muted-foreground mt-0.5">{agent.domain}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {agent.usageCount.toLocaleString()} uses
                          </span>
                          {accuracy !== null && (
                            <span
                              className={cn(
                                "text-[10px] font-mono",
                                accuracy > 98
                                  ? "text-lime-700 dark:text-lime-400"
                                  : accuracy > 95
                                    ? "text-amber-700 dark:text-amber-400"
                                    : "text-rose-700 dark:text-rose-400"
                              )}
                            >
                              {accuracy}% acc
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
              )}
            </TabsContent>
          ))}
        </Tabs>
        <div className="px-4 py-3 border-t bg-muted/30 text-[11px] text-muted-foreground leading-relaxed">
          Global agents are shared and immutable across every firm; Firm/Client/User agents are
          scoped to their boundary and enforced by Row Level Security, not just this UI. Usage
          counts and accuracy update as the self-improvement loops (Wave 5) run.
        </div>
      </SheetContent>
    </Sheet>
  );
}
