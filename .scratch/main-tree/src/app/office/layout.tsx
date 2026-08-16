import type { Metadata } from "next";

// VERIDIAN OFFICE AI OS — the original complete-business-system landing page,
// relocated from the site root in Wave 112. The root is now the VERIDIAN
// COGNITIVE AI OS research-lab page; this page keeps the full product-selling
// metadata it previously carried at "/" so a separate domain can be pointed
// straight at /office without losing search/link-preview identity.
export const metadata: Metadata = {
  title: "VERIDIAN OFFICE AI OS — Your Complete Business, Run by Your AI Assistant",
  description:
    "One complete business system — 50+ modules across finance, sales, CRM, HR, projects, operations and compliance — run end-to-end by your own AI assistant. Tell it what to do. Consider it done.",
  keywords: [
    "AI business system",
    "AI office",
    "business operating system",
    "AI assistant for business",
    "ERP alternative",
    "all-in-one business software",
    "VERIDIAN",
  ],
  openGraph: {
    title: "VERIDIAN OFFICE AI OS — Tell it what to do. Consider it done.",
    description:
      "One complete business system of 50+ modules, run by your own AI assistant. Replace the stack — accounting, CRM, HR, projects, compliance — with one system.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VERIDIAN OFFICE AI OS — Tell it what to do. Consider it done.",
    description:
      "One complete business system of 50+ modules, run by your own AI assistant.",
  },
};

export default function OfficeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
