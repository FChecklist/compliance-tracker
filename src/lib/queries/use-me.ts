"use client";

import { useQuery } from "@tanstack/react-query";

export type MeResponse = {
  id: string | null;
  name: string | null;
  email: string | null;
  role: string | null;
  // Priority 18b (Owner directive 2026-07-15): 'stage_0' | null.
  accountStage: string | null;
  orgId: string | null;
  orgName: string | null;
  orgSlug: string | null;
  orgEntityType: string | null;
  orgAccountType: string;
  orgRegulatoryEntityType: string;
  pmsEnabled: boolean;
  veriChatV2Enabled: boolean;
  firmEnabled: boolean;
  orgPlan: string;
  trialEndsAt: string | null;
  // Wave B (BYOB white-label branding): always already-defaulted server-side
  // (org-branding-service.ts's resolveBranding()) -- orgLogoUrl is null only
  // when the org hasn't set a custom logo (render the default /logo-mark.svg
  // in that case), the two colors are never null for an org with a real
  // orgId (they fall back to VERIDIAN AI's own default hex values).
  orgLogoUrl: string | null;
  orgBrandPrimaryColor: string | null;
  orgBrandAccentColor: string | null;
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
