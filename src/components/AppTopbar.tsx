"use client";

import Link from "next/link";
import { Bell, User, Settings, LogOut, ChevronDown } from "lucide-react";
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

export function AppTopbar() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => setUnreadCount(d.unreadCount ?? 0))
      .catch(() => {});
  }, []);

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
                  RS
                </AvatarFallback>
              </Avatar>
              <span className="hidden md:inline text-sm font-medium">Rajesh Sharma</span>
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
              onClick={() => router.push("/")}
            >
              <LogOut className="size-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}