"use client";

import { useState } from "react";
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
import { cn } from "@/lib/utils";
import {
  ASSISTANTS,
  TIER_COLOR,
  TIER_LABEL,
  WORKER_AGENTS,
  type AgentTier,
} from "@/lib/orchestra-mock-data";

const TIERS: AgentTier[] = ["global", "firm", "client", "user"];

export function AgentLibrarySheet() {
  const [open, setOpen] = useState(false);

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
            4 tiers · {WORKER_AGENTS.length} worker agents (example data — see roadmap below)
          </SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="global" className="flex-1 flex flex-col overflow-hidden gap-0">
          <TabsList className="mx-4 mt-2">
            {TIERS.map((tier) => (
              <TabsTrigger key={tier} value={tier} className="text-xs">
                {TIER_LABEL[tier]}
                <span className="ml-1 opacity-60">
                  {WORKER_AGENTS.filter((a) => a.tier === tier).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {TIERS.map((tier) => (
            <TabsContent key={tier} value={tier} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 mt-0">
              {WORKER_AGENTS.filter((a) => a.tier === tier).map((agent) => {
                const c = TIER_COLOR[agent.tier];
                const usedBy = ASSISTANTS.filter((a) => a.agentIds.includes(agent.id));
                return (
                  <div key={agent.id} className="rounded-lg border p-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{agent.name}</span>
                      {agent.tier === "global" && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0">
                          Immutable
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{agent.domain}</p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {agent.usageCount.toLocaleString()} uses
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-mono",
                          agent.accuracy > 98
                            ? "text-lime-700 dark:text-lime-400"
                            : agent.accuracy > 95
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-rose-700 dark:text-rose-400"
                        )}
                      >
                        {agent.accuracy}% acc
                      </span>
                    </div>
                    {usedBy.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {usedBy.map((a) => (
                          <span
                            key={a.id}
                            className={cn("text-[9px] px-1.5 py-0.5 rounded-full border", c.bg, c.text, c.border)}
                          >
                            {a.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </TabsContent>
          ))}
        </Tabs>
        <div className="px-4 py-3 border-t bg-muted/30 text-[11px] text-muted-foreground leading-relaxed">
          Agents self-improve via 15 continuous loops (Wave 5). Global agents are shared and
          immutable across every firm; Firm/Client/User agents are scoped to their boundary and
          never visible outside it. This library is example content — real worker-agent storage
          and execution land in Wave 3.
        </div>
      </SheetContent>
    </Sheet>
  );
}
