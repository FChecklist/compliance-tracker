import type { Metadata } from "next";

// Wave 113 SEO: without this layout, /the-firm inherits the Cognitive root
// metadata — wrong tab title, wrong search snippet, wrong link previews.
export const metadata: Metadata = {
  title: "THE FIRM AI OS — Practice Management for CA, CS, Legal & Audit Firms",
  description:
    "Big-4-style practice management for Indian professional firms: one client roster, one deadline radar, staff utilisation, tax cases, engagements and one-click billing — run by AI.",
  keywords: ["CA firm software", "practice management India", "law firm software", "CS firm software", "audit practice management", "tax case tracking", "THE FIRM AI OS", "VERIDIAN"],
  openGraph: {
    title: "THE FIRM AI OS — Your whole practice, at a glance",
    description: "One client roster, one deadline radar, one view of who's overloaded — across CA, CS, Legal, GRC and Audit service lines.",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "THE FIRM AI OS", description: "Practice management for professional firms — run by AI." },
};

export default function TheFirmLayout({ children }: { children: React.ReactNode }) {
  return children;
}
