import { Suspense } from "react";
import { headers } from "next/headers";
import { Loader2 } from "lucide-react";
import { resolveBrandingByHost } from "@/lib/services/org-branding-service";
import { LoginForm } from "./login-form";

function LoginFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-navy">
      <Loader2 className="size-8 text-ct-saffron animate-spin" />
    </div>
  );
}

// Stage 1 (pre-authentication, host-header-based) brand resolution --
// GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH, 2026-08-04. Login is itself
// pre-auth (this is the page that GRANTS auth, it can't read a session to
// decide what to render) -- the host header is the only signal available
// here, exactly the layer the Owner's priority order puts it in. A host
// with no matching organisations.customDomain resolves to null and
// LoginForm renders exactly as before this wave (undefined `brand` prop).
export default async function LoginPage() {
  const host = (await headers()).get("host");
  const brand = await resolveBrandingByHost(host);
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm brand={brand ? { name: brand.brandName, logoUrl: brand.logoUrl } : undefined} />
    </Suspense>
  );
}