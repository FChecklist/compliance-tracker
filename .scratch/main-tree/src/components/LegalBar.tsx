// Wave 113: the one-line corporate + legal strip under every product page's
// footer. Publishes the corporate identity only — never director names.
import Link from "next/link";

export function LegalBar() {
  return (
    <div className="border-t border-ct-border/60 bg-ct-cream">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-5 text-xs text-ct-muted md:flex-row md:items-center md:justify-between">
        <span>
          Owned and operated by SHOBHA KAMAL SOLUTIONS PRIVATE LIMITED, a company incorporated in India under the
          Companies Act. Part of{" "}
          <Link href="/" className="underline underline-offset-2 hover:text-ct-navy">VERIDIAN COGNITIVE AI OS</Link>.
        </span>
        <span className="flex gap-4">
          <Link href="/terms" className="hover:text-ct-navy">Terms & Conditions</Link>
          <Link href="/privacy" className="hover:text-ct-navy">Privacy Policy</Link>
          <Link href="/data-policy" className="hover:text-ct-navy">Data Policy</Link>
        </span>
      </div>
    </div>
  );
}
