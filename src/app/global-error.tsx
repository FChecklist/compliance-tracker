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
    <html lang="en">
      <head>
        <style>{`.mark139{position:absolute;top:0;left:0;right:0;margin:0;padding:1px 0 0;text-align:center;line-height:1;pointer-events:none;user-select:none;z-index:2147483647;font-family:"Noto Sans Devanagari","Mukta","Nirmala UI","Mangal","Kohinoor Devanagari","Devanagari Sangam MN",sans-serif;font-size:6px;font-weight:700;color:#0B2A6B}.mark139 span{display:inline-block;border-bottom:.5px solid #7A1010;padding-bottom:.5px}`}</style>
      </head>
      <body>
        <div className="mark139" lang="hi" aria-hidden="true"><span>१३९</span></div>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
