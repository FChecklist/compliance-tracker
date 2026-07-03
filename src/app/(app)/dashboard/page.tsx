"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Wave 15: Home Page restructure. /dashboard's content moved to
// src/components/home/DashboardAnalytics.tsx (now the org-wide tier of
// Home's Analytics tab) -- this route redirects for continuity rather than
// 404ing every existing bookmark/link.
export default function DashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/home");
  }, [router]);
  return null;
}
