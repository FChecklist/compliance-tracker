import type { Metadata } from "next";

// Wave 113 SEO: product-specific metadata (see the-firm/layout.tsx rationale).
export const metadata: Metadata = {
  title: "FORGE — Custom AI Systems, Engineered to Order | VERIDIAN",
  description:
    "Fully custom AI-native systems of any complexity at a flat engineering cost — BYOK, no recurring platform rent. The same research and platform discipline behind VERIDIAN, applied to a problem that is only yours.",
  keywords: ["custom AI development", "AI engineering", "bespoke software India", "AI system development", "FORGE", "VERIDIAN"],
  openGraph: {
    title: "FORGE — AI Engineering by VERIDIAN",
    description: "Custom cognitive systems, engineered to order. Flat cost, BYOK, no rent.",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "FORGE — AI Engineering", description: "Custom AI systems at a flat engineering cost." },
};

export default function ForgeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
