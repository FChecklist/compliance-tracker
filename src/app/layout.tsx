import type { Metadata } from "next";
import { Inter, DM_Serif_Display } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import QueryProvider from "@/components/providers/QueryProvider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-dm-serif-display",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${dmSerifDisplay.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>{children}</QueryProvider>
        </ThemeProvider>
        <Toaster position="top-right" richColors />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}