"use client";

// Wave 112: one sales section, every product page. All four public product
// pages (/office, /the-firm, /forge, /veri-fm-cs) embed this so the selling
// motion is identical everywhere: (1) the product itself is the demo — a
// free account is live in minutes, (2) a guided demo with a human, (3) the
// partner programme. All of it feeds ONE sales organisation — the Wave 109
// Sales Engine (/sales-hq internally, /partner/<token> for partners,
// /r/<token> referral links that land on these very pages with attribution).
//
// CONTACT NOTE FOR THE OWNER: SALES_EMAIL is the owner inbox (already public
// in this repo) so the buttons actually deliver from day one — swap it for a
// branded sales inbox (e.g. sales@ your domain) when one exists.

import Link from "next/link";
import { ArrowRight, MonitorPlay, Handshake, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";

const SALES_EMAIL = "raajat.agarwal@gmail.com";

export function ProductSalesSection({ product }: { product: string }) {
  const demoSubject = encodeURIComponent(`Demo request — ${product}`);
  const partnerSubject = encodeURIComponent(`Partner programme — ${product}`);

  const cards = [
    {
      icon: MonitorPlay,
      title: "The product is the demo",
      body: `Open a free account and watch ${product} work on your own data — live in minutes, no sales call required first.`,
      cta: (
        <Link href="/signup">
          <Button className="rounded-full bg-ct-saffron hover:bg-ct-saffron-hover text-white px-6">
            Start a live demo <ArrowRight className="ml-1 size-4" />
          </Button>
        </Link>
      ),
    },
    {
      icon: CalendarClock,
      title: "Guided demo with our team",
      body: "Thirty minutes on your actual use case — your workflows, your data shapes, your questions. We show, you decide.",
      cta: (
        <a href={`mailto:${SALES_EMAIL}?subject=${demoSubject}`}>
          <Button variant="outline" className="rounded-full border-ct-border text-ct-navy px-6">
            Book a guided demo
          </Button>
        </a>
      ),
    },
    {
      icon: Handshake,
      title: "Sell it as a partner",
      body: "Resellers, consultants, referral and commission agents get a personal referral link and a live dashboard — pipeline, conversions and commission, per product.",
      cta: (
        <a href={`mailto:${SALES_EMAIL}?subject=${partnerSubject}`}>
          <Button variant="outline" className="rounded-full border-ct-border text-ct-navy px-6">
            Join the partner programme
          </Button>
        </a>
      ),
    },
  ];

  return (
    <section id="sales" className="bg-white border-y border-ct-border/60">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ct-teal">Sales & demos</div>
          <h2 className="mt-3 font-heading text-3xl sm:text-4xl text-ct-navy">Three ways to see it, one team behind all of them</h2>
          <p className="mx-auto mt-4 max-w-2xl text-ct-slate">
            Every VERIDIAN product is sold and demonstrated through one sales organisation — VERIDIAN AI OS Sales —
            so whichever door you walk in through, you talk to people who know the whole system.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {cards.map((c) => (
            <div key={c.title} className="flex flex-col rounded-2xl border border-ct-border/60 bg-ct-cream p-7">
              <span className="grid size-10 place-items-center rounded-xl bg-ct-navy text-white">
                <c.icon className="size-5 text-ct-saffron" />
              </span>
              <h3 className="mt-5 font-heading text-xl text-ct-navy">{c.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-ct-slate">{c.body}</p>
              <div className="mt-6">{c.cta}</div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-ct-muted">
          Already a partner? Your dashboard link was sent when your account was created — pipeline, paid conversions and
          commission update in real time.
        </p>
      </div>
    </section>
  );
}
