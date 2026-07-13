"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// @tanstack/react-query was already a dependency but had never been wired up
// -- every page fetched its own copy of shared data (e.g. /api/me and
// /api/compliance/stats were each independently fetched by 3-4 different
// components on every /home load) instead of sharing one request and one
// cache entry. This provider makes that sharing possible; see
// src/lib/queries/*.ts for the actual shared query hooks.
export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // These endpoints change slowly enough (org profile, compliance
            // counts) that refetching on every mount/focus across several
            // components was pure waste -- 30s keeps things reasonably fresh
            // without reintroducing the fan-out this was meant to fix.
            staleTime: 30_000,
            retry: 2,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
