import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";

// OCID-020 category 23 real fix (2026-08-14, UX audit heuristic 10): every
// (app) route except /help is still proxy-redirected to /login before this
// layout ever renders for an anonymous visitor (src/proxy.ts,
// PROTECTED_APP_ROUTE_PREFIXES) -- this auth check only ever changes real
// behavior for /help, the one deliberate public exception
// (scripts/generate-protected-routes.mjs's PUBLIC_APP_ROUTE_EXCEPTIONS).
// AppShell assumes an authenticated session (sidebar, topbar, chat dock,
// useMe()) -- wrapping an anonymous /help visitor's real pre-auth FAQ
// content in it would render broken/irrelevant authenticated chrome around
// otherwise-correct content, so it's skipped entirely when there's no user.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}
