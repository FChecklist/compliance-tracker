"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "issues", label: "Issues" },
  { id: "board", label: "Board" },
  { id: "sprints", label: "Sprints" },
  { id: "wiki", label: "Wiki" },
  { id: "time", label: "Time" },
  { id: "budgets", label: "Budgets" },
  { id: "meetings", label: "Meetings" },
  { id: "roadmap", label: "Roadmap" },
];

export default function ProjectNav({ projectId, projectName }: { projectId: string; projectName: string }) {
  const pathname = usePathname();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link href="/pms" className="text-sm text-ct-muted hover:text-ct-navy">VERIDIAN AI PMS</Link>
        <span className="text-sm text-ct-muted">/</span>
        <h1 className="font-heading text-xl text-ct-navy">{projectName}</h1>
      </div>
      <div className="flex gap-1 border-b border-ct-border">
        {TABS.map((tab) => {
          const href = `/pms/${projectId}/${tab.id}`;
          const isActive = pathname === href || pathname?.startsWith(`${href}/`);
          return (
            <Link
              key={tab.id}
              href={href}
              className={cn(
                "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                isActive ? "border-ct-saffron text-ct-saffron" : "border-transparent text-ct-slate hover:text-ct-navy"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
