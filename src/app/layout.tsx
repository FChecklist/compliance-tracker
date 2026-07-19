import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import QueryProvider from "@/components/providers/QueryProvider";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { veridianHeadingFont, veridianSansFont } from "@fchecklist/veridian-ui-kit/tokens/fonts";
import "./globals.css";

export const metadata: Metadata = {
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