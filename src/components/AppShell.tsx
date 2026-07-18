"use client";

import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { HealthRibbon } from "@/components/HealthRibbon";
import TrialBanner from "@/components/TrialBanner";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import GlobalChatDock, { isDockHiddenForPath } from "@/components/GlobalChatDock";
// HelpWidget was built in an earlier session wave but never wired into any
// render tree — imported and rendered here as a fixed-position floating
// widget that lives for the entire authenticated session.
import HelpWidget from "@/components/HelpWidget";
import TaskVisibilityPanel from "@/components/TaskVisibilityPanel";
import { VeriChatProvider } from "@/components/veri-chat/veri-chat-context";
import VeriComposer from "@/components/veri-chat/VeriComposer";
import VeriChatPanel from "@/components/veri-chat/VeriChatPanel";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle, ssrSafeLocalStorage } from "@/components/ui/resizable";
import { useDefaultLayout } from "react-resizable-panels";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useResilientPoll } from "@/lib/use-resilient-poll";
import { useMe } from "@/lib/queries/use-me";
import { useComplianceStats } from "@/lib/queries/use-compliance-stats";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const dockHidden = isDockHiddenForPath(pathname);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [unreadAiCount, setUnreadAiCount] = useState(0);
  const [connectedConnectorsCount, setConnectedConnectorsCount] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // react-resizable-panels v4 dropped Group's `autoSaveId` prop in favor of
  // this hook (see resizable.tsx's own header comment for the rest of the
  // v3->v4 migration) -- same persisted layout key as before, just wired
  // through the officially documented replacement API instead of a prop.
  const { defaultLayout: veriChatPanelLayout, onLayoutChange: onVeriChatPanelLayoutChange } = useDefaultLayout({ id: "veridian-shell-panels", storage: ssrSafeLocalStorage });

  // Shared react-query cache -- previously each of these was its own
  // fetch-on-mount effect here, duplicating the same /api/me and
  // /api/compliance/stats requests HealthRibbon, AchievementCard, AppTopbar
  // and the home page were independently making too. useMe()/useComplianceStats()
  // dedupe across every consumer instead.
  const { data: me } = useMe();
  const { data: stats } = useComplianceStats();
  // Priority 18b (Owner directive 2026-07-15, design doc section 2.2 point
  // 2): a stage-0 user's ENTIRE authenticated surface is the dedicated,
  // standalone /stage0-chat page (outside this org-scoped AppShell, same
  // pattern as /guest-chat and /shared/conversation) -- not a conditional
  // branch inside AppShell/AppSidebar's existing chrome. AppShell's own
  // widgets (HealthRibbon, TrialBanner, OnboardingChecklist, GlobalChatDock,
  // VeriComposer, pmsEnabled/veriChatV2Enabled/firmEnabled, overdue/notice
  // counts) all assume a real orgId and would break or need extensive
  // per-component null-org guards for what the design doc frames as a
  // cosmetic "only show Chat" nav requirement -- this redirect achieves the
  // same real outcome (a stage-0 user never sees org-wide chrome) more
  // robustly. Real security is still server-side: role:'stage_0' rank 1
  // already rejects every requireRole(..., 'member')-or-higher route
  // regardless of what page renders.
  useEffect(() => {
    if (me?.accountStage === "stage_0") router.replace("/stage0-chat");
  }, [me?.accountStage, router]);
  const overdueCount = stats?.overdue ?? 0;
  const noticeCount = stats?.noticeCount ?? 0;
  const accountType = me?.orgAccountType ?? "company";
  const pmsEnabled = me?.pmsEnabled ?? false;
  const veriChatV2Enabled = me?.veriChatV2Enabled ?? false;
  const firmEnabled = me?.firmEnabled ?? false;
  const orgName = me?.orgName ?? "";
  // Wave B (BYOB white-label branding): already-defaulted by /api/me
  // (org-branding-service.ts's resolveBranding()) -- orgLogoUrl is only
  // ever null for "no custom logo configured," never an error state, and
  // the two colors always have a real value once orgId exists. Applied as
  // CSS custom properties on the shell's own root wrapper below (not by
  // overriding the design system's existing --color-ct-* Tailwind theme
  // tokens, which Tailwind v4's `@theme inline` inlines as literal values
  // at build time and can't be safely overridden at runtime) -- see
  // globals.css's :root block for the matching --org-brand-primary/
  // --org-brand-accent defaults these shadow per-tenant.
  const orgLogoUrl = me?.orgLogoUrl ?? null;
  const orgBrandPrimaryColor = me?.orgBrandPrimaryColor ?? undefined;
  const orgBrandAccentColor = me?.orgBrandAccentColor ?? undefined;

  useEffect(() => {
    // Connectors sidebar/composer badge (Connectors.docx wave, 2026-07-10):
    // one-shot fetch, not polled -- connection status changes rarely enough
    // (a user connecting/disconnecting a toolkit) that a 15s interval like
    // unread chat counts would be pure waste; the /connectors page itself
    // already polls live during an active OAuth handshake.
    fetch("/api/connectors")
      .then((r) => r.json())
      .then((d) => {
        const toolkits: { connected: boolean }[] = d.toolkits ?? [];
        setConnectedConnectorsCount(toolkits.filter((t) => t.connected).length);
      })
      .catch(() => {});
  }, []);

  // Wave 146 gap-closure fix: this used to be a bare loadUnreadChat() +
  // setInterval(loadUnreadChat, 15000) with no in-flight guard and no
  // backoff -- during a real backend outage (DB unreachable etc.) it kept
  // firing a brand-new request every 15s regardless of whether the
  // previous one had even resolved yet, on every authenticated screen,
  // indefinitely. useResilientPoll only schedules the next attempt after
  // the current one settles, and backs off (capped) on repeated failures,
  // recovering back to the normal 15s cadence the moment a call succeeds.
  const loadUnreadChat = useCallback(async () => {
    try {
      const r = await fetch("/api/conversations");
      if (!r.ok) return false;
      const d = await r.json();
      // Wave 37: VERI AI and VERI Chat are now separate nav entries, so
      // their unread badges are computed separately from the same
      // fetch (PLATFORM_STRATEGY.md §18).
      const conversations: { unreadCount: number; isAiThread: boolean }[] = d.conversations ?? [];
      setUnreadAiCount(conversations.filter((c) => c.isAiThread).reduce((sum, c) => sum + c.unreadCount, 0));
      setUnreadChatCount(conversations.filter((c) => !c.isAiThread).reduce((sum, c) => sum + c.unreadCount, 0));
      return true;
    } catch {
      return false;
    }
  }, []);
  useResilientPoll(loadUnreadChat, 15000);

  // veriChatV2Enabled orgs get the persistent composer + independent VERI
  // Chat panel (product branch 'veri_chat_v2', gated per-org, reversible
  // without a redeploy -- see veri-chat-v2-enablement-service.ts). Every
  // other org renders exactly as before: this whole branch is additive,
  // not a rewrite of the existing flow.
  const body = (
    <>
      {/* print:hidden -- every element in this persistent chrome group is
          app navigation/interactive overlay, not page content. Hidden here
          (not in each component file) so the print stylesheet's coverage of
          "every authenticated view" (dashboard, reports, invoices, etc.) is
          guaranteed by this one shared shell, not by every page remembering
          to opt in individually. See globals.css's "Print Stylesheet"
          section for the rest of the print rules (page-break handling,
          @page margins, .print-only / .no-print utilities for content that
          needs finer control than this file's chrome-vs-content split). */}
      <div className="print:hidden">
        <AppTopbar
          sidebarCollapsed={veriChatV2Enabled ? sidebarCollapsed : undefined}
          onToggleSidebar={veriChatV2Enabled ? () => setSidebarCollapsed((v) => !v) : undefined}
        />
        <HealthRibbon />
      </div>
      {/* D5.B6: rendered here (in the shared `body` markup, above the
          veriChatV2/legacy branch split below) so it's always present in the
          authenticated chrome regardless of which org branch renders --
          TaskVisibilityPanel itself uses useVeriChatOptional() to stay safe
          when VeriChatProvider isn't mounted (legacy branch). */}
      <div className="print:hidden">
        <TaskVisibilityPanel />
      </div>
      <div className="flex flex-1 overflow-hidden print:block print:overflow-visible">
        {/* Collapsing conditionally renders AppSidebar rather than toggling a
            CSS width -- AppSidebar sets its own min-width internally, which
            would otherwise fight a wrapper's width:0. Only ever collapsible
            on the veriChatV2 branch; sidebarCollapsed stays false for every
            other org since the toggle button isn't rendered for them. */}
        {!(veriChatV2Enabled && sidebarCollapsed) && (
          <div className="print:hidden">
            <AppSidebar overdueCount={overdueCount} noticeCount={noticeCount} accountType={accountType} unreadChatCount={unreadChatCount} unreadAiCount={unreadAiCount} connectedConnectorsCount={connectedConnectorsCount} pmsEnabled={pmsEnabled} firmEnabled={firmEnabled} orgName={orgName} orgLogoUrl={orgLogoUrl} />
          </div>
        )}
        {veriChatV2Enabled ? (
          // Merged-Home-page pattern (compliance-tracker/veridian-scope-selector-in-home.html,
          // the Owner's agreed UI/UX reference, confirmed 2026-07-18): on
          // /home, VeriChatPanel merges into the main content area instead
          // of sitting in its own side panel -- VeriChatPanel itself reads
          // the same shared veri-chat-context state either way, so nothing
          // it shows changes, only where it's mounted. Real, confirmed drift
          // fixed here: this branch previously always rendered the 2-panel
          // split, including on /home, despite the reference mockup calling
          // for the panel to disappear there.
          pathname === "/home" ? (
            <div className="flex-1 flex flex-col overflow-hidden print:block print:overflow-visible print:h-auto">
              <main className="flex-1 overflow-auto p-4 md:p-6 bg-ct-cream print:overflow-visible print:p-0 print:bg-white">
                {children}
              </main>
              <div className="print:hidden">
                <VeriComposer connectedConnectorsCount={connectedConnectorsCount} />
              </div>
            </div>
          ) : (
            <ResizablePanelGroup orientation="horizontal" defaultLayout={veriChatPanelLayout} onLayoutChange={onVeriChatPanelLayoutChange} className="flex-1 overflow-hidden print:block print:overflow-visible">
              <ResizablePanel defaultSize={72} minSize={50}>
                <div className="h-full flex flex-col overflow-hidden print:block print:overflow-visible print:h-auto">
                  <main className="flex-1 overflow-auto p-4 md:p-6 bg-ct-cream print:overflow-visible print:p-0 print:bg-white">
                    <div className="print:hidden">
                      <OnboardingChecklist />
                      <TrialBanner />
                    </div>
                    {children}
                  </main>
                  <div className="print:hidden">
                    <VeriComposer connectedConnectorsCount={connectedConnectorsCount} />
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={28} minSize={18} maxSize={40} className="print:hidden">
                <VeriChatPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          )
        ) : (
          <main className={cn("flex-1 overflow-auto p-4 md:p-6 bg-ct-cream print:overflow-visible print:p-0 print:bg-white", !dockHidden && "pb-28 md:pb-32")}>
            {/* /home leads with the assistant (first-minute experience) -- the
                legacy Get Started checklist would sit above it speaking old
                compliance language, so it stays on every page except Home. */}
            <div className="print:hidden">
              {pathname !== "/home" && <OnboardingChecklist />}
              <TrialBanner />
            </div>
            {children}
          </main>
        )}
      </div>
      {!veriChatV2Enabled && (
        <div className="print:hidden">
          <GlobalChatDock />
        </div>
      )}
      {/* HelpWidget: floating help-chat button/panel, fixed-position, rendered
          once per authenticated session alongside other global overlays. */}
      <div className="print:hidden">
        <HelpWidget />
      </div>
    </>
  );

  return (
    <div
      className="flex h-screen flex-col overflow-hidden print:block print:h-auto print:overflow-visible"
      style={{
        "--org-brand-primary": orgBrandPrimaryColor,
        "--org-brand-accent": orgBrandAccentColor,
      } as React.CSSProperties}
    >
      {veriChatV2Enabled ? <VeriChatProvider>{body}</VeriChatProvider> : body}
    </div>
  );
}
