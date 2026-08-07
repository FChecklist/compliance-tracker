"use client";

import { useEffect, useState } from "react";

/**
 * Gap closure, 2026-08-07 (VERIDIAN Review Framework, "Offline Cache
 * Support"): no navigator.onLine-based hook existed anywhere in the repo
 * before this (confirmed by grep) -- this is the one place that tracks it,
 * for OfflineShell's banner.
 *
 * Defaults to `true` (online) so server-rendered/first-paint markup never
 * flashes an incorrect "offline" banner before hydration -- `navigator` is
 * undefined during SSR, and the real value is read in the effect below on
 * mount, then kept live via the online/offline window events.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return isOnline;
}
