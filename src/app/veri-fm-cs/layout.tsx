import type { Metadata } from "next";

// Wave 113 SEO: product-specific metadata (see the-firm/layout.tsx rationale).
export const metadata: Metadata = {
  title: "VERI FM & CS AI OS — Facilities Management, Built for Ground Staff",
  description:
    "Asset registers digitized from photographs, PPM that schedules itself, AMC tracking and visitor management — facilities software your ground staff will actually use, run by AI.",
  keywords: ["facilities management software India", "PPM software", "asset register digitization", "AMC tracking", "CAFM", "VERI FM", "VERIDIAN"],
  openGraph: {
    title: "VERI FM & CS AI OS — Maintenance that schedules itself",
    description: "Facilities & corporate services engineered for the people who hold the clipboard.",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "VERI FM & CS AI OS", description: "Facilities management your ground staff will actually use." },
};

export default function VeriFmCsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
