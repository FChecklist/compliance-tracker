"use client";

import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { HealthRibbon } from "@/components/HealthRibbon";
import TrialBanner from "@/components/TrialBanner";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import PageAgentInitializer from "@/components/PageAgentInitializer";
import GlobalChatDock, { isDockHiddenForPath } from "@/components/GlobalChatDock";
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
  const [pmsEnabled, setPmsEnabled] = useState(false);

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

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <PageAgentInitializer />
      <AppTopbar />
      <HealthRibbon />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar overdueCount={overdueCount} noticeCount={noticeCount} accountType={accountType} unreadChatCount={unreadChatCount} unreadAiCount={unreadAiCount} pmsEnabled={pmsEnabled} />
        <main className={cn("flex-1 overflow-auto p-4 md:p-6 bg-ct-cream", !dockHidden && "pb-28 md:pb-32")}>
          <OnboardingChecklist />
          <TrialBanner />
          {children}
        </main>
      </div>
      <GlobalChatDock />
    </div>
  );
}