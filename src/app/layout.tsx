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
  title: "Veridian AI — AI-Native Compliance & Audit Operating System",
  description:
    "Never miss a compliance deadline. AI extracts data from your notice PDFs, tracks filings, and calculates penalties in seconds. The single source of truth for Indian compliance.",
  keywords: [
    "Veridian AI",
    "compliance",
    "GST",
    "TDS",
    "MCA",
    "AI compliance",
    "audit management",
    "penalty calculator",
    "compliance OS",
  ],
  icons: { icon: "/logo-mark.svg" },
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