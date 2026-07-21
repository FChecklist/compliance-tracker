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
  // audit198 RULE-043: server-computed (see notification-priority-service.ts
  // + drizzle/0251's compute_notification_priority() trigger), already
  // ranked most-important-first by the API -- this field is for the
  // per-item visual cue below, not client-side re-sorting.
  priority: "critical" | "high" | "medium" | "low";
  isRead: boolean;
  metadata: { conversationId?: string; mismatchId?: string } | null;
  createdAt: string;
};

const PRIORITY_DOT_CLASS: Record<NotificationItem["priority"], string> = {
  critical: "bg-red-600",
  high: "bg-amber-500",
  medium: "bg-ct-saffron",
  low: "bg-ct-muted",
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
  // audit198 RULE-043 ("...prevent information overload..."): count of
  // lower-priority notifications the API deliberately held back (see
  // capForOverload in notification-priority-service.ts) so this dropdown
  // never gets flooded past the point of being scannable.
  const [overflowCount, setOverflowCount] = useState(0);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  // Shared react-query cache instead of its own /api/me fetch-on-mount.
  const { data: me } = useMe();
  const orgName = me?.orgName ?? null;
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
        setOverflowCount(d.overflowCount ?? 0);
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

  const notificationSlot = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="relative veri-icon-btn" title="Notifications">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 size-2.5 rounded-full bg-red-500 ring-2 ring-white" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
        {notificationsList.length === 0 ? (
          <div className="px-3 py-4 text-sm text-ct-muted text-center">No notifications</div>
        ) : (
          <>
            {notificationsList.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="flex-col items-start gap-0.5 whitespace-normal"
                onClick={() => handleNotificationClick(n)}
              >
                <div className="flex items-center gap-2 w-full">
                  {/* audit198 RULE-043: priority dot so the user's next
                      most important action is visually obvious without
                      opening each item -- red/amber (critical/high) reads
                      as "act now" vs. the pre-existing plain unread dot,
                      which only meant "unseen", not "urgent". */}
                  <span className={`size-1.5 rounded-full shrink-0 ${PRIORITY_DOT_CLASS[n.priority] ?? PRIORITY_DOT_CLASS.medium}`} title={`Priority: ${n.priority}`} />
                  {!n.isRead && <span className="size-1.5 rounded-full bg-ct-saffron shrink-0" />}
                  <span className="text-sm font-medium text-ct-navy">{n.title}</span>
                </div>
                <p className="text-xs text-ct-muted">{n.message}</p>
              </DropdownMenuItem>
            ))}
            {overflowCount > 0 && (
              <div className="px-3 py-2 text-xs text-ct-muted text-center border-t border-ct-border">
                +{overflowCount} more lower-priority update{overflowCount === 1 ? "" : "s"}
              </div>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const userMenuSlot = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2 text-ct-navy hover:bg-ct-cloud">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-ct-saffron text-white text-xs font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden md:inline text-sm font-medium">
            {userName || "User"}
          </span>
          <ChevronDown className="size-3 text-ct-muted" />
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
        productName="VERIDIAN AI"
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
