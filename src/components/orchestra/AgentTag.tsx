import { agentById, TIER_COLOR } from "@/lib/orchestra-mock-data";
import { cn } from "@/lib/utils";

export function AgentTag({ agentId }: { agentId: string }) {
  const agent = agentById(agentId);
  if (!agent) return null;
  const c = TIER_COLOR[agent.tier];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap border",
        c.bg,
        c.text,
        c.border
      )}
      title={`${agent.domain} · ${agent.usageCount.toLocaleString()} uses · ${agent.accuracy}% accuracy`}
    >
      {agent.name}
    </span>
  );
}
