"use client";

// Gap closure, 2026-08-07 (VERIDIAN Review Framework, Cache & Synchronization
// / "Offline Cache Support", Critical). Rendered once, globally, by
// AppShell (same pattern as HelpWidget just above it) -- so it's live on
// every authenticated page. Two responsibilities:
//   1. Register public/sw.js (see that file's header for the full scope --
//      read-only, allowlisted FM/site-diary GET routes + static assets
//      only). Registration itself is pure enhancement: an unsupported
//      browser or a blocked registration must never break the app, hence
//      the swallowed .catch() below.
//   2. Surface a visible "you're offline" signal via useOnlineStatus --
//      before this, going offline produced only silent failed fetches /
//      generic error toasts with no explicit explanation.
import { useEffect } from "react";
import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/use-online-status";

export default function OfflineShell() {
  const isOnline = useOnlineStatus();

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // best-effort -- see file header
      });
    }
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full bg-ct-navy text-white text-sm px-4 py-2 shadow-lg print:hidden">
      <WifiOff className="h-4 w-4" />
      You&apos;re offline — showing last saved data where available.
    </div>
  );
}
