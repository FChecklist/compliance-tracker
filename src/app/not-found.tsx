import Link from "next/link";
import { Button } from "@/components/ui/button";

// OCID-020 category 23 fix (UMR-20260806-132527-30dc): real, minimal 404
// page. Before this file existed, an unmatched route fell through to
// Next.js's built-in not-found page, which the real GTM UX audit (heuristic
// 9 -- "help users recognize, diagnose, and recover from errors") confirmed
// renders zero navLinks/footerLinks/helpLinks/buttons: a plain-language
// message with no way forward except the browser's own back button. This
// page keeps the same plain-language message but adds the two real, cheap
// escape routes a lost visitor needs: back to the marketing home page, and
// a way to reach a human (the real /contact form) if they expected a page
// that no longer exists.
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ct-cream px-4">
      <div className="max-w-md text-center space-y-6">
        <p className="font-heading text-6xl text-ct-navy">404</p>
        <h1 className="font-heading text-2xl text-ct-navy">This page could not be found.</h1>
        <p className="text-sm text-ct-muted">
          The page you're looking for doesn't exist or may have moved. Here's how to get back on track.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/">
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              Back to home
            </Button>
          </Link>
          <Link href="/contact">
            <Button variant="outline">Contact support</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
