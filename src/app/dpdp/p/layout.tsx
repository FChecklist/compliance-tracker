import type { Metadata } from "next"

// WO-DPDP-012 §0/§2: /dpdp/p/<token> is the data-principal (parent /
// customer) consent page -- a token in the URL plus personal data, never
// to be indexed, crawled or cited. page.tsx is a client component and so
// cannot export metadata itself; this server layout carries the <meta
// name="robots"> half of §2's "meta AND header" requirement. The header
// half comes from next.config.ts via dpdp-public-surface.ts (the broad
// /dpdp/:path* block covers this path). Moving the token itself out of the
// URL path into the # fragment (§2's third bullet) is a client-side
// rewrite of this page and is sequenced with WO-DPDP-011's static port,
// not done here.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function PrincipalLayout({ children }: { children: React.ReactNode }) {
  return children
}
