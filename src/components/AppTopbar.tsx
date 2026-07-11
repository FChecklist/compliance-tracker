"use client";

import Link from "next/link";
import { Bell, User, Settings, LogOut, ChevronDown, Loader2, PanelLeft, Plus } from "lucide-react";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { SearchTrigger } from "@/components/search-command";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { InviteUserModal } from "@/components/InviteUserModal";

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  metadata: { conversationId?: string; mismatchId?: string } | null;
  createdAt: string;
};

export function AppTopbar({ sidebarCollapsed, onToggleSidebar }: { sidebarCollapsed?: boolean; onToggleSidebar?: () => void } = {}) {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsList, setNotificationsList] = useState<NotificationItem[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
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

    // Fetch org name from /api/me
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => { if (d.orgName) setOrgName(d.orgName); })
      .catch(() => {});
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

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-4 px-4 md:px-6 bg-gradient-navy shadow-nav sticky top-0 z-30">
      {/* Left: hamburger is handled by AppSidebar (mobile) */}

      {/* Sidebar collapse toggle -- only rendered for orgs on the
          veriChatV2 branch (onToggleSidebar is undefined otherwise) */}
      {onToggleSidebar && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          className="text-white/80 hover:text-white hover:bg-white/10"
        >
          <PanelLeft className="size-4" />
        </Button>
      )}

      {/* Org name (visible on md+) */}
      <div className="hidden md:block">
        {orgName && <h2 className="text-sm font-medium text-white/90">{orgName}</h2>}
      </div>

      {/* Center spacer */}
      <div className="flex-1" />

      {/* Search */}
      <SearchTrigger />

      {/* Theme toggle */}
      <ThemeToggle />

      {/* Right: invite + notification + user */}
      <div className="flex items-center gap-2">
        {/* Persistent "Invite a team member" control (U-D28) -- minimalist
            "+" icon, upper-right, on every authenticated screen. */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowInvite(true)}
          title="Invite a team member"
          aria-label="Invite a team member"
          className="text-white/80 hover:text-white hover:bg-white/10"
        >
          <Plus className="size-[18px]" />
        </Button>

        {/* Notification bell */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative text-white/80 hover:text-white hover:bg-white/10"
            >
              <Bell className="size-[18px]" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-red-500 ring-2 ring-ct-navy" />
              )}
            </Button>
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

        {/* User avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="gap-2 px-2 text-white/90 hover:text-white hover:bg-white/10"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-ct-saffron text-white text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden md:inline text-sm font-medium">
                {userName || "User"}
              </span>
              <ChevronDown className="size-3 text-white/50" />
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
      </div>

      <InviteUserModal open={showInvite} onOpenChange={setShowInvite} />
    </header>
  );
}