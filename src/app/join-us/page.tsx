import Link from "next/link";
import Image from "next/image";
import { JoinUsSection } from "@/components/JoinUsSection";

export const metadata = { title: "Join Us — VERIDIAN AI" };

export default function JoinUsPage() {
  return (
    <main className="min-h-screen bg-[#F4F1E8] text-[#1a1a17] antialiased">
      <nav className="border-b border-[#1a1a17]/10">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5 font-heading text-lg tracking-tight">
            <Image src="/logo-mark.svg" alt="VERIDIAN" width={28} height={28} priority />
            <span>
              VERIDIAN <span className="text-[#1a1a17]/50">COGNITIVE AI OS</span>
            </span>
          </Link>
          <div className="hidden items-center gap-8 text-sm text-[#1a1a17]/70 md:flex">
            <Link href="/#research" className="hover:text-[#1a1a17]">Research</Link>
            <Link href="/#products" className="hover:text-[#1a1a17]">Products</Link>
            <Link href="/#cost" className="hover:text-[#1a1a17]">On cost</Link>
            <Link href="/join-us" className="text-[#1a1a17]">Join Us</Link>
          </div>
          <Link
            href="/contact"
            className="rounded-full border border-[#1a1a17]/20 px-5 py-2 text-sm hover:bg-[#1a1a17] hover:text-[#F4F1E8] transition-colors"
          >
            Contact Us
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-4xl px-6 pt-20 pb-24 md:pt-28">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#1a1a17]/50">Join Us</div>
        <h1 className="mt-4 max-w-2xl font-heading text-4xl leading-tight sm:text-5xl">
          One team, three ways in
        </h1>
        <p className="mt-5 max-w-xl leading-relaxed text-[#1a1a17]/70">
          Whichever path fits, it starts with the same conversation — tell us a bit about yourself below.
        </p>

        <div className="mt-12">
          <JoinUsSection />
        </div>
      </section>

      <footer className="border-t border-[#1a1a17]/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 font-heading">
            <Image src="/logo-mark.svg" alt="VERIDIAN" width={22} height={22} />
            <span>VERIDIAN <span className="text-[#1a1a17]/50">COGNITIVE AI OS</span></span>
          </div>
          <div className="text-sm text-[#1a1a17]/50">© {new Date().getFullYear()} VERIDIAN AI</div>
        </div>
      </footer>
    </main>
  );
}
