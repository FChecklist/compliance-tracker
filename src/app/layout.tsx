import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import QueryProvider from "@/components/providers/QueryProvider";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { headers } from "next/headers";
import { resolvePreAuthBrandByHost } from "@/lib/services/org-branding-service";
import { veridianHeadingFont, veridianSansFont } from "@fchecklist/veridian-ui-kit/tokens/fonts";
import "./globals.css";

const DEFAULT_TITLE = "VERIDIAN COGNITIVE AI OS — AI Cognitive Research";
const DEFAULT_DESCRIPTION =
  "AI cognitive research that becomes advanced, working products. VERIDIAN builds operating systems that perceive a company's state, decide, act, and account for every action — bounded by a constitution, accountable to a ledger.";

// OCID-038 GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH, Stage 1 real
// implementation (UMR-20260804-090421-c647): a static `metadata` export
// cannot see the real HTTP Host header -- `generateMetadata()` is the real,
// standard Next.js mechanism for a per-request-dynamic title, and it is the
// ONLY thing this change makes dynamic. Every other metadata field
// (keywords, openGraph, twitter) is left exactly as it was: real,
// VERIDIAN-research-lab-specific marketing copy that has no honest PROJEXA
// equivalent to substitute in yet (see this OCID's own PROGRESS.md note on
// why the root landing page itself redirects rather than being reskinned).
// Unmatched host (the overwhelming common case) resolves to the exact same
// literal default title as the static export it replaces.
export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));
  const title = brand ? `${brand.brandName} — powered by VERIDIAN` : DEFAULT_TITLE;

  return {
    title,
    description: DEFAULT_DESCRIPTION,
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
      title,
      description:
        "We research how a business thinks — then build the system that thinks for it. Advanced AI products and projects: OFFICE, THE FIRM, FM & CS, FORGE.",
      url: "https://veridian-ai-os.vercel.app",
      siteName: "VERIDIAN COGNITIVE AI OS",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description:
        "AI cognitive research that becomes advanced, working products — systems that perceive, decide, act, and account for themselves.",
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