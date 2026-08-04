import type { Metadata } from "next";
import { headers } from "next/headers";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import QueryProvider from "@/components/providers/QueryProvider";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { veridianHeadingFont, veridianSansFont } from "@fchecklist/veridian-ui-kit/tokens/fonts";
import { resolveBrandingByHost } from "@/lib/services/org-branding-service";
import "./globals.css";

const DEFAULT_METADATA: Metadata = {
  // Repositioned 2026-07-07 (Wave 112): the site root is now VERIDIAN
  // COGNITIVE AI OS — the research-lab identity above the whole product
  // family. The complete-business-system selling metadata moved with its
  // page to /office/layout.tsx; product pages under /the-firm, /forge and
  // /veri-fm-cs carry their own. This block is the browser tab, search
  // headline and link preview for the lab itself.
  title: "VERIDIAN COGNITIVE AI OS — AI Cognitive Research",
  description:
    "AI cognitive research that becomes advanced, working products. VERIDIAN builds operating systems that perceive a company's state, decide, act, and account for every action — bounded by a constitution, accountable to a ledger.",
  keywords: [
    "VERIDIAN",
    "cognitive AI",
    "AI research",
    "AI operating system",
    "enterprise AI",
    "AI agents",
    "purpose-bound AI",
    "accountable AI",
  ],
  icons: { icon: "/logo-mark.svg" },
  openGraph: {
    title: "VERIDIAN COGNITIVE AI OS — AI Cognitive Research",
    description:
      "We research how a business thinks — then build the system that thinks for it. Advanced AI products and projects: OFFICE, THE FIRM, FM & CS, FORGE.",
    url: "https://veridian-ai-os.vercel.app",
    siteName: "VERIDIAN COGNITIVE AI OS",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VERIDIAN COGNITIVE AI OS — AI Cognitive Research",
    description:
      "AI cognitive research that becomes advanced, working products — systems that perceive, decide, act, and account for themselves.",
  },
};

// Stage 1 (pre-authentication, host-header-based) brand resolution --
// GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH, 2026-08-04. This is the
// document-level identity (browser tab title, favicon, link previews) for
// the whole domain -- it has no post-login override today (Stage 2's
// resolveBranding(orgId), unchanged, governs the in-app chrome rendered by
// AppShell.tsx, not this metadata), so it correctly stays host-resolved on
// every route under a branded domain, matching the Owner's deterministic
// priority order (host header is the base layer; nothing more specific
// overrides the document title/favicon yet). A host with no matching
// organisations.customDomain (e.g. the base VERIDIAN domain) falls back to
// DEFAULT_METADATA, unchanged from before this wave.
export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host");
  const branding = await resolveBrandingByHost(host);
  if (!branding) return DEFAULT_METADATA;
  return {
    ...DEFAULT_METADATA,
    title: `${branding.brandName} — powered by VERIDIAN`,
    icons: branding.faviconUrl ? { icon: branding.faviconUrl } : DEFAULT_METADATA.icons,
    openGraph: {
      ...DEFAULT_METADATA.openGraph,
      title: branding.brandName,
      siteName: branding.brandName,
    },
    twitter: {
      ...DEFAULT_METADATA.twitter,
      title: branding.brandName,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // PLATFORM-01 Wave 2 (Workstream 5): resolves via src/i18n/request.ts's
  // cookie-based lookup (no [locale] URL segment in this app). Root-level
  // provider so every "use client" component below it (AppSidebar,
  // login/signup forms, etc.) can call useTranslations()/useLocale()
  // without each needing its own provider.
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${veridianSansFont.variable} ${veridianHeadingFont.variable} font-sans antialiased`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
          >
            <QueryProvider>{children}</QueryProvider>
          </ThemeProvider>
          <Toaster position="top-right" richColors />
        </NextIntlClientProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}