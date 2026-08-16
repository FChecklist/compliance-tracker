"use client";

// Wave 113: VERIDIAN SALES AI — the client half. Dropped into every public
// page (root + 4 product pages), it does four jobs with one tiny footprint:
//
//   1. Identity: a self-generated anonymous id in localStorage (no cookies
//      needing consent walls, no PII — disclosed in /privacy).
//   2. Journey: page_view on mount, section_view as each section[id] scrolls
//      into view (once per section per load), cta_click on any /signup link.
//   3. Drop-off: on pagehide, a sendBeacon "exit" event carrying the last
//      section reached — Sales HQ's funnel reads this as "where they stopped."
//   4. Conversion push: one exit-intent offer per session — desktop cursor
//      leaving the viewport top, or mobile deep-scroll-then-idle — asks the
//      backend rules ladder for a customized offer and renders it.
//
// The visitor id is also read by /signup (VERIDIAN_VID in localStorage) so
// autoProvisionUser() can close the visit→signup loop, mirroring how Wave
// 109's ?ref= attribution works.

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { X, Sparkles } from "lucide-react";
import { getVisitorId } from "@/lib/visitor-id";

const OFFER_SESSION_KEY = "VERIDIAN_OFFER_SHOWN";
// Discount popup was showing on live public pages unapproved — disabled.
// Tracking (page/section/CTA/exit events) stays on; only the offer modal is off.
const OFFER_ENABLED = false;

type Offer = { code: string; headline: string; body: string; discountPct: number; validHours: number };

function track(body: Record<string, unknown>, useBeacon = false) {
  const payload = JSON.stringify(body);
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
    } else {
      fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
    }
  } catch {
    // analytics must never break the page
  }
}

export function VisitorIntelligence({ page, productKey }: { page: string; productKey?: string }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const sectionsSeen = useRef<string[]>([]);
  const offerRequested = useRef(false);
  const vidRef = useRef<string>("");

  const requestOffer = useCallback(async () => {
    if (!OFFER_ENABLED) return;
    if (offerRequested.current) return;
    // one offer per browser session, across all our pages
    try {
      if (sessionStorage.getItem(OFFER_SESSION_KEY)) return;
    } catch { /* ignore */ }
    offerRequested.current = true;
    try {
      const res = await fetch("/api/track/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId: vidRef.current, productKey, sectionsSeen: sectionsSeen.current }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.offer) {
        setOffer(data.offer);
        try { sessionStorage.setItem(OFFER_SESSION_KEY, "1"); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }, [productKey]);

  useEffect(() => {
    const vid = getVisitorId();
    vidRef.current = vid;
    track({ visitorId: vid, eventType: "page_view", page, productKey, referrer: document.referrer || undefined });

    // section journey
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id;
          if (e.isIntersecting && id && !sectionsSeen.current.includes(id)) {
            sectionsSeen.current.push(id);
            track({ visitorId: vid, eventType: "section_view", page, productKey, section: id });
          }
        }
      },
      { threshold: 0.4 }
    );
    document.querySelectorAll("section[id]").forEach((s) => observer.observe(s));

    // CTA clicks toward signup
    const onClick = (ev: MouseEvent) => {
      const a = (ev.target as HTMLElement).closest?.('a[href^="/signup"]');
      if (a) track({ visitorId: vid, eventType: "cta_click", page, productKey, section: sectionsSeen.current.at(-1) });
    };
    document.addEventListener("click", onClick, true);

    // drop-off: last section reached before leaving
    const onPageHide = () => {
      track(
        { visitorId: vid, eventType: "exit", page, productKey, section: sectionsSeen.current.at(-1), metadata: { sectionsSeen: sectionsSeen.current } },
        true
      );
    };
    window.addEventListener("pagehide", onPageHide);

    // exit intent — desktop: cursor exits viewport top
    const onMouseOut = (ev: MouseEvent) => {
      if (ev.clientY <= 0 && !ev.relatedTarget) void requestOffer();
    };
    document.addEventListener("mouseout", onMouseOut);

    // exit intent — mobile proxy: reached deep scroll, then 25s idle
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      const deep = window.scrollY > document.body.scrollHeight * 0.5;
      if (idleTimer) clearTimeout(idleTimer);
      if (deep) idleTimer = setTimeout(() => void requestOffer(), 25000);
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("mouseout", onMouseOut);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("scroll", onScroll);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [page, productKey, requestOffer]);

  if (!offer) return null;

  const dismiss = () => {
    track({ visitorId: vidRef.current, eventType: "offer_dismissed", page, productKey, metadata: { code: offer.code } });
    setOffer(null);
  };
  const accept = () => {
    track({ visitorId: vidRef.current, eventType: "offer_clicked", page, productKey, metadata: { code: offer.code } });
    try { localStorage.setItem("VERIDIAN_OFFER_CODE", offer.code); } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-7 shadow-2xl">
        <div className="flex items-start justify-between">
          <span className="grid size-10 place-items-center rounded-xl bg-ct-navy text-white">
            <Sparkles className="size-5 text-ct-saffron" />
          </span>
          <button onClick={dismiss} aria-label="Close offer" className="text-ct-muted hover:text-ct-navy p-1">
            <X className="size-5" />
          </button>
        </div>
        <h3 className="mt-4 font-heading text-2xl text-ct-navy">{offer.headline}</h3>
        <p className="mt-2 text-sm leading-relaxed text-ct-slate">{offer.body}</p>
        <div className="mt-4 rounded-lg border border-dashed border-ct-saffron bg-ct-saffron/5 px-4 py-2.5 text-center">
          <span className="text-xs uppercase tracking-wider text-ct-muted">Your code · valid {offer.validHours}h</span>
          <div className="font-heading text-lg tracking-widest text-ct-saffron">{offer.code}</div>
        </div>
        <div className="mt-5 flex gap-3">
          <Link href="/signup" onClick={accept} className="flex-1">
            <span className="block w-full rounded-full bg-ct-saffron px-5 py-3 text-center text-sm font-medium text-white hover:bg-ct-saffron-hover">
              Claim {offer.discountPct}% off — start free
            </span>
          </Link>
          <button onClick={dismiss} className="rounded-full border border-ct-border px-5 py-3 text-sm text-ct-slate hover:text-ct-navy">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
