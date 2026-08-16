"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

// Catches React render errors that escape every route-level error.tsx --
// the last line of defense before a blank white screen. Reports to Sentry
// (no-ops until SENTRY_DSN is configured) then falls back to Next's own
// built-in error page since this component can't assume any of the app's
// providers/layout are mounted.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
