"use client";

import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { HealthRibbon } from "@/components/HealthRibbon";
import TrialBanner from "@/components/TrialBanner";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import PageAgentInitializer from "@/components/PageAgentInitializer";
import GlobalChatDock, { isDockHiddenForPath } from "@/components/GlobalChatDock";
// HelpWidget was built in an earlier session wave but never wired into any
// render tree — imported and rendered here as a fixed-position floating
// widget that lives for the entire authenticated session.
import HelpWidget from "@/components/HelpWidget";
import { VeriChatProvider } from "@/components/veri-chat/veri-chat-context";
import VeriComposer from "@/components/veri-chat/VeriComposer";
import VeriChatPanel from "@/components/veri-chat/VeriChatPanel";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const dockHidden = isDockHiddenForPath(pathname);
  const [overdueCount, setOverdueCount] = useState(0);
  const [noticeCount, setNoticeCount] = useState(0);
  const [accountType, setAccountType] = useState("company");
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [unreadAiCount, setUnreadAiCount] = useState(0);
  const [connectedConnectorsCount, setConnectedConnectorsCount] = useState(0);
  const [pmsEnabled, setPmsEnabled] = useState(false);
  const [veriChatV2Enabled, setVeriChatV2Enabled] = useState(false);
  const [firmEnabled, setFirmEnabled] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    fetch("/api/compliance/stats")
      .then((r) => r.json())
      .then((d) => {
        setOverdueCount(d.overdue ?? 0);
        setNoticeCount(d.noticeCount ?? 0);
      })
      .catch(() => {});
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        setAccountType(d.orgAccountType ?? "company");
        setPmsEnabled(d.pmsEnabled ?? false);
        setVeriChatV2Enabled(d.veriChatV2Enabled ?? false);
        setFirmEnabled(d.firmEnabled ?? false);
        setOrgName(d.orgName ?? "");
      })
      .catch(() => {});
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

    function loadUnreadChat() {
      fetch("/api/conversations")
        .then((r) => r.json())
        .then((d) => {
          // Wave 37: VERI AI and VERI Chat are now separate nav entries, so
          // their unread badges are computed separately from the same
          // fetch (PLATFORM_STRATEGY.md §18).
          const conversations: { unreadCount: number; isAiThread: boolean }[] = d.conversations ?? [];
          setUnreadAiCount(conversations.filter((c) => c.isAiThread).reduce((sum, c) => sum + c.unreadCount, 0));
          setUnreadChatCount(conversations.filter((c) => !c.isAiThread).reduce((sum, c) => sum + c.unreadCount, 0));
        })
        .catch(() => {});
    }
    loadUnreadChat();
    const interval = setInterval(loadUnreadChat, 15000);
    return () => clearInterval(interval);
  }, []);

  // veriChatV2Enabled orgs get the persistent composer + independent VERI
  // Chat panel (product branch 'veri_chat_v2', gated per-org, reversible
  // without a redeploy -- see veri-chat-v2-enablement-service.ts). Every
  // other org renders exactly as before: this whole branch is additive,
  // not a rewrite of the existing flow.
  const body = (
    <>
      <PageAgentInitializer />
      <AppTopbar
        sidebarCollapsed={veriChatV2Enabled ? sidebarCollapsed : undefined}
        onToggleSidebar={veriChatV2Enabled ? () => setSidebarCollapsed((v) => !v) : undefined}
      />
      <HealthRibbon />
      <div className="flex flex-1 overflow-hidden">
        {/* Collapsing conditionally renders AppSidebar rather than toggling a
            CSS width -- AppSidebar sets its own min-width internally, which
            would otherwise fight a wrapper's width:0. Only ever collapsible
            on the veriChatV2 branch; sidebarCollapsed stays false for every
            other org since the toggle button isn't rendered for them. */}
        {!(veriChatV2Enabled && sidebarCollapsed) && (
          <AppSidebar overdueCount={overdueCount} noticeCount={noticeCount} accountType={accountType} unreadChatCount={unreadChatCount} unreadAiCount={unreadAiCount} connectedConnectorsCount={connectedConnectorsCount} pmsEnabled={pmsEnabled} firmEnabled={firmEnabled} orgName={orgName} />
        )}
        {veriChatV2Enabled ? (
          <ResizablePanelGroup direction="horizontal" autoSaveId="veridian-shell-panels" className="flex-1 overflow-hidden">
            <ResizablePanel defaultSize={72} minSize={50}>
              <div className="h-full flex flex-col overflow-hidden">
                <main className="flex-1 overflow-auto p-4 md:p-6 bg-ct-cream">
                  {pathname !== "/home" && <OnboardingChecklist />}
                  <TrialBanner />
                  {children}
                </main>
                <VeriComposer connectedConnectorsCount={connectedConnectorsCount} />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={28} minSize={18} maxSize={40}>
              <VeriChatPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <main className={cn("flex-1 overflow-auto p-4 md:p-6 bg-ct-cream", !dockHidden && "pb-28 md:pb-32")}>
            {/* /home leads with the assistant (first-minute experience) -- the
                legacy Get Started checklist would sit above it speaking old
                compliance language, so it stays on every page except Home. */}
            {pathname !== "/home" && <OnboardingChecklist />}
            <TrialBanner />
            {children}
          </main>
        )}
      </div>
      {!veriChatV2Enabled && <GlobalChatDock />}
      {/* HelpWidget: floating help-chat button/panel, fixed-position, rendered
          once per authenticated session alongside other global overlays. */}
      <HelpWidget />
    </>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {veriChatV2Enabled ? <VeriChatProvider>{body}</VeriChatProvider> : body}
    </div>
  );
}
