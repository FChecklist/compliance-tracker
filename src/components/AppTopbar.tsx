"use client";

import Link from "next/link";
import { Bell, User, Settings, LogOut, ChevronDown, Loader2 } from "lucide-react";
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

export function AppTopbar() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
 fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => setUnreadCount(d.unreadCount ?? 0))
      .catch(() => {});

    // Get current user from Supabase
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUserEmail(user.email);
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

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-4 px-4 md:px-6 bg-gradient-navy shadow-nav sticky top-0 z-30">
      {/* Left: hamburger is handled by AppSidebar (mobile) */}

      {/* Org name (visible on md+) */}
      <div className="hidden md:block">
        <h2 className="text-sm font-medium text-white/90">Acme Financial Services</h2>
      </div>

      {/* Center spacer */}
      <div className="flex-1" />

      {/* Search */}
      <SearchTrigger />

      {/* Theme toggle */}
      <ThemeToggle />

      {/* Right: notification + user */}
      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <Button
          variant="ghost"
          size="icon"
          className="relative text-white/80 hover:text-white hover:bg-white/10"
          onClick={() => router.push("/compliance?status=overdue")}
        >
          <Bell className="size-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-red-500 ring-2 ring-ct-navy" />
          )}
        </Button>

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
    </header>
  );
}