"use client";

import { useQuery } from "@tanstack/react-query";

export type MeResponse = {
  id: string | null;
  name: string | null;
  email: string | null;
  role: string | null;
  orgId: string | null;
  orgName: string | null;
  orgSlug: string | null;
  orgEntityType: string | null;
  orgAccountType: string;
  orgRegulatoryEntityType: string;
  pmsEnabled: boolean;
  veriChatV2Enabled: boolean;
  firmEnabled: boolean;
  pageAgentEnabled: boolean;
  orgPlan: string;
  trialEndsAt: string | null;
};

async function fetchMe(): Promise<MeResponse> {
  const r = await fetch("/api/me");
  if (!r.ok) throw new Error("Failed to fetch /api/me");
  return r.json();
}

// Shared across every consumer (AppShell, AppTopbar, home page, chat page,
// GlobalChatDock, ...) -- one request and one cache entry per staleTime
// window instead of each component firing its own fetch on mount.
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: fetchMe });
}
