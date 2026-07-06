import type { Metadata } from "next";
import { Inter, DM_Serif_Display } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
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
  // Repositioned 2026-07-06 with the new landing page: VERIDIAN is sold as
  // ONE complete business system run by your AI assistant — not a
  // compliance/audit tool. This title is the browser tab, the search-result
  // headline, and every link preview, so it must carry the same message.
  title: "VERIDIAN AI — Your Complete Business, Run by Your AI Assistant",
  description:
    "One SAP-class system of 50+ modules — finance, sales, CRM, HR, operations, compliance — driven end to end by your own AI assistant. Tell it what to do. Consider it done. 10× productivity, save 2× what you spend.",
  keywords: [
    "VERIDIAN AI",
    "AI assistant for business",
    "AI business system",
    "all-in-one business software",
    "AI ERP",
    "accounting software",
    "CRM",
    "HR and payroll software",
    "inventory management",
    "compliance",
    "business automation",
    "AI for SMB India",
  ],
  icons: { icon: "/logo-mark.svg" },
  openGraph: {
    title: "VERIDIAN AI — Tell it what to do. Consider it done.",
    description:
      "The complete system your company runs on — 50+ modules, one bill, operated for you by your own AI assistant. No other software needed.",
    url: "https://veridian-ai-os.vercel.app",
    siteName: "VERIDIAN AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VERIDIAN AI — Tell it what to do. Consider it done.",
    description:
      "One complete business system — finance, sales, CRM, HR, operations, compliance — run by your AI assistant. 10× productivity, 2× savings.",
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
          {children}
        </ThemeProvider>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}