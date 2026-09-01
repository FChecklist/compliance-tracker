"use client";

import { Bell, User, Settings, LogOut, ChevronDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@fchecklist/veridian-ui-kit/shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { SearchTrigger } from "@/components/search-command";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { InviteUserModal } from "@/components/InviteUserModal";
import { useMe } from "@/lib/queries/use-me";

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  metadata: { conversationId?: string; mismatchId?: string } | null;
  createdAt: string;
};

// veridian-ui-kit migration (2026-07-19): the shared AppHeader owns the
// generic icon-row layout/spacing/styling (ported verbatim from the
// mockup's own light-themed <header>, replacing this file's previous dark
// bg-gradient-navy bar -- a mockup-alignment correction, not an accidental
// restyle, same class as AppShellFrame's home-merge fix). Every data-bearing
// piece -- search trigger, notification list, invite button, user menu --
// stays this repo's own real logic, wired through AppHeader's slot props.
// The logo+"VERIDIAN AI" wordmark block is new here (the old dark topbar
// had no logo at all, only AppSidebar did) -- ported from the mockup's own
// header, which does show one.
export function AppTopbar({ sidebarCollapsed, onToggleSidebar }: { sidebarCollapsed?: boolean; onToggleSidebar?: () => void } = {}) {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsList, setNotificationsList] = useState<NotificationItem[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  // Shared react-query cache instead of its own /api/me fetch-on-mount.
  const { data: me } = useMe();
  const orgName = me?.orgName ?? null;
  const brandName = me?.brandName ?? null;
  const [loggingOut, setLoggingOut] = useState(false);
  // U-D28: "'Invite a team member' control must appear on every screen, on
  // every webpage, upper-right corner" -- AppTopbar is rendered globally by
  // AppShell for every authenticated page, so putting it here satisfies
  // that. Reuses the same POST /api/users mechanism as the /users page via
  // the shared InviteUserModal -- no new invite backend.
  const [showInvite, setShowInvite] = useState(false);

  useEffect(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => {
        setUnreadCount(d.unreadCount ?? 0);
        setNotificationsList(d.notifications ?? []);
      })
      .catch(() => {});

    // Get current user from Supabase
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUserEmail(user.email ?? null);
        setUserName(user.user_metadata?.full_name || user.email?.split("@")[0] || null);
      }
    });
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Failed to sign out");
      setLoggingOut(false);
      return;
    }
    // Gap closure, 2026-08-07 ("Offline Cache Support"): the offline shell
    // (OfflineShell.tsx / public/sw.js) caches org-scoped read-only data
    // (FM register digitization rows, site diary lists) in the browser's
    // Cache Storage. That storage is per-origin, not per-signed-in-user --
    // on a shared/kiosk browser, the next person to sign in could otherwise
    // still see the previous org's cached data until it happened to be
    // overwritten. Best-effort and non-blocking, same as everything else in
    // this handler being fire-and-forget-safe: an unsupported browser or a
    // failed cache.delete must never block sign-out.
    if (typeof caches !== "undefined") {
      caches.keys().then((keys) => keys.forEach((key) => caches.delete(key))).catch(() => {});
    }
    router.push("/login");
    router.refresh();
  };

  const initials = userName
    ? userName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "CT";

  async function handleNotificationClick(n: NotificationItem) {
    if (!n.isRead) {
      fetch(`/api/notifications/${n.id}/read`, { method: "PATCH" }).catch(() => {});
      setNotificationsList((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    if (n.type === "instruction_mismatch" && n.metadata?.conversationId) {
      router.push(`/chat?conversation=${n.metadata.conversationId}&highlight=${n.metadata.mismatchId ?? ""}`);
    } else {
      router.push("/compliance?status=overdue");
    }
  }

  // R-1224-REBASE (accessibility PR #1224 rebase, 2026-08-31): the sidebar-
  // collapse toggle button PR #1224 originally added an `aria-label` to
  // here directly (this file used to render its own dark `<header>` with a
  // literal `<Button onClick={onToggleSidebar}>` inline) has since moved
  // into the external `@fchecklist/veridian-ui-kit` shared `<AppHeader>`
  // component (see node_modules/@fchecklist/veridian-ui-kit/src/shell/
  // AppHeader.tsx) as part of the same veridian-ui-kit migration that
  // rewrote this whole file. That shared button still only has a `title`,
  // no `aria-label` -- a real, same-class WCAG 4.1.2 gap, but fixing it
  // requires a change to that separate repo, out of this PR's scope.
  // Flagged, not silently dropped. The notification bell, unread-dot,
  // user-menu trigger, avatar and chevron below are all still this repo's
  // own markup, so those accessibility fixes ARE applied here.
  const notificationSlot = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative veri-icon-btn"
          title="Notifications"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span aria-hidden="true" className="absolute top-1 right-1 size-2.5 rounded-full bg-red-500 ring-2 ring-white" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
        {notificationsList.length === 0 ? (
          <div className="px-3 py-4 text-sm text-ct-muted text-center">No notifications</div>
        ) : (
          notificationsList.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className="flex-col items-start gap-0.5 whitespace-normal"
              onClick={() => handleNotificationClick(n)}
            >
              <div className="flex items-center gap-2 w-full">
                {!n.isRead && <span className="size-1.5 rounded-full bg-ct-saffron shrink-0" />}
                <span className="text-sm font-medium text-ct-navy">{n.title}</span>
              </div>
              <p className="text-xs text-ct-muted">{n.message}</p>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const userMenuSlot = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="gap-2 px-2 text-ct-navy hover:bg-ct-cloud"
          aria-label={`Account menu for ${userName || "User"}`}
        >
          <Avatar className="h-8 w-8" aria-hidden="true">
            <AvatarFallback className="bg-ct-saffron text-white text-xs font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden md:inline text-sm font-medium">
            {userName || "User"}
          </span>
          <ChevronDown className="size-3 text-ct-muted" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem className="gap-2" onClick={() => router.push("/settings")}>
          <User className="size-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onClick={() => router.push("/settings")}>
          <Settings className="size-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-red-600 focus:text-red-600"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          {loggingOut ? "Signing out..." : "Sign Out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <AppHeader
        productName={brandName || "VERIDIAN AI"}
        onToggleSidebar={onToggleSidebar}
        sidebarCollapsed={sidebarCollapsed}
        searchSlot={<SearchTrigger />}
        contextLabel={orgName ? <span className="hidden md:inline">{orgName}</span> : undefined}
        notificationSlot={notificationSlot}
        userMenuSlot={userMenuSlot}
        extraActions={
          <div className="flex items-center gap-0.5">
            <ThemeToggle />
            <LanguageSwitcher />
            {/* Persistent "Invite a team member" control (U-D28) --
                minimalist "+" icon, upper-right, on every authenticated
                screen. */}
            <button
              type="button"
              onClick={() => setShowInvite(true)}
              title="Invite a team member"
              aria-label="Invite a team member"
              className="veri-icon-btn"
            >
              <Plus className="size-4" />
            </button>
          </div>
        }
      />
      <InviteUserModal open={showInvite} onOpenChange={setShowInvite} />
    </>
  );
}
