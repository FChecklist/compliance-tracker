"use client"

// DPDP marketing/landing page -- shown to a genuinely anonymous visitor at
// /dpdp (no session cookie at all; see page.tsx's three-way branch).
//
// Content and structure ported from the owner-supplied reference mockup
// (veridian-complete.html, "V.site()" -- the website layer of a larger
// multi-persona prototype covering the product's other 3 layers too, which
// are OUT of scope here: only the public marketing site was asked for).
// Copy is preserved close to verbatim -- it's real, carefully-written
// content, not a draft to rewrite. Two real, functional pieces were ported
// as genuine interactivity rather than static mockup text:
//   - The penalty-exposure calculator: client-side state, same formula as
//     the reference (own = emp+cust+app+vis+other; out = vend*vstaff+adv*2).
//   - "Start free" email capture: calls the SAME real endpoint the actual
//     login page uses (/api/dpdp/auth/request-link), not a fake success
//     message -- a submitted email really does receive a real magic link.
//
// The Schedule-to-the-Act penalty figures (₹250cr/₹200cr/₹150cr/₹50cr/
// ₹10,000) are the Act's own statutory ceilings per instance, per the
// reference content -- kept verbatim, not invented here.

import { useState } from "react"
import Link from "next/link"
import { dpdpFetch } from "../_lib/api"

const PENALTIES: [string, string][] = [
  ["₹250 cr", "S.8(5) security"],
  ["₹200 cr", "S.8(6) breach notice"],
  ["₹200 cr", "S.9 children"],
  ["₹150 cr", "S.10 SDF"],
  ["₹50 cr", "residual"],
  ["₹10,000", "S.15 individual"],
]

const FEATURES: { icon: string; title: string; body: string; badge?: string }[] = [
  { icon: "🗂️", title: "Where your data actually is", body: "Not “we hold Aadhaar” — the folder, the software, the cupboard. Unknown ones get asked to whoever runs that system." },
  { icon: "🎧", title: "A Grievance Officer, published", body: "Named, appointed properly, on a permanent page. Required by S.8(10).", badge: "FREE, ALWAYS" },
  { icon: "🌐", title: "Your own public page", body: "For the 70% of Indian businesses who cannot edit their own website, or have none.", badge: "FREE, ALWAYS" },
  { icon: "📧", title: "One email a day, and it is the dashboard", body: "Your people answer yes or no from their inbox. Most never open the website at all." },
  { icon: "🤖", title: "An AI Link for any chatbox", body: "Paste it into ChatGPT and let it do the work. It can read, never change. You approve every suggestion." },
  { icon: "🛡️", title: "Proof that survives people", body: "Dated, unalterable, kept ten years. The IT man leaves; the record does not." },
  { icon: "🗄️", title: "We never keep your documents", body: "Fingerprints, names and dates. The file stays on your machine. We cannot lose what we never had." },
  { icon: "🗑️", title: "Deleting somebody, everywhere", body: "Their data is in seven places. We know each one, ask each holder, and prove it afterwards." },
  { icon: "📨", title: "Consent that people actually give", body: "Item by item, on a link. Withdrawing is the same tap as agreeing, because the law says it must be." },
  { icon: "🚨", title: "72 hours, planned in advance", body: "Who is affected, worked out from your data map in minutes rather than weeks." },
  { icon: "🧑‍⚖️", title: "Auditors and cyber firms, listed", body: "With what each is actually qualified for. We take no commission from any of them." },
  { icon: "🔗", title: "Your vendors, in the same system", body: "Free for them, walled off from each other, and blocked until they sign." },
]

const WE_DO = "Write down what you hold and where · turn the Act into duties with names and dates · chase them · check the proof · publish your officer and your notices · keep a record nobody can edit · answer people who ask"
const WE_DONT = "Touch your systems · keep your documents · certify you as compliant · give legal advice · quote penalties at you · promise nobody will ever be fined"

const SEGMENTS: { icon: string; title: string; body: string }[] = [
  { icon: "🏭", title: "A company, school or NGO", body: "Run it yourself from day one. Invite a CA later without redoing anything." },
  { icon: "📊", title: "A CA, CS, audit or legal firm", body: "No licence fee, ever. You pay per client file, after you have billed the client. Your own firm's file is free." },
  { icon: "🔗", title: "A web agency, payroll bureau or IT firm", body: "Free. Your clients attach you, you sign, you answer what only you know." },
  { icon: "🔎", title: "An auditor or cyber firm", body: "Listed on our panel with what you are actually qualified for. We take no commission from you." },
]

const FAQ: [string, string][] = [
  ["We run on Gmail. Does that matter?", "No. Most Indian companies do. Sign-in is a link to whatever address you use — Gmail, Yahoo or your own domain."],
  ["Has anybody actually been fined?", "No. No penalty order has been issued in India to date, and the Board's members are not yet appointed. The date is the real thing, not the fear."],
  ["We are small. Does this apply to us?", "Yes. There is no size exemption in the Act. A ten-person firm holding customer phone numbers is a Data Fiduciary."],
  ["Do you touch our systems?", "Never. We do not connect to your software, read your files or install anything. We record what you tell us and hold you to it."],
  ["Do you keep our documents?", "No. We keep a fingerprint, a name and a date. The document stays with you — which is why you must keep your own originals."],
  ["Can you certify us as compliant?", "No, and neither can anyone else. There is no government DPDP certification in India. We document and we record."],
  ["What if we stop paying?", "Your proof stays readable and exportable. You lose new entries, not old ones. We do not hold it hostage."],
  ["What happens if you disappear?", "Your whole record exports in open formats with the fingerprints intact, and verifies without us. That is the point of building it this way."],
]

function EmailCapture({ align = "center" }: { align?: "center" | "left" }) {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await dpdpFetch("/api/dpdp/auth/request-link", { method: "POST", body: JSON.stringify({ email }) })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl bg-[#FCE7F3] p-4 text-sm text-[#9F1239]">
        📧 Check your inbox — we&apos;ve sent a link to <b>{email}</b>. One click and you&apos;re in. No password to choose and none to forget.
      </div>
    )
  }

  return (
    <form onSubmit={submit} className={`flex flex-wrap gap-2 ${align === "center" ? "justify-center" : ""}`}>
      <input
        type="email"
        required
        placeholder="your email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="min-w-[190px] flex-1 rounded-lg border-[1.5px] border-[#E6E2F5] px-4 py-3 text-sm"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-gradient-to-r from-[#6D28D9] to-[#DB2777] px-6 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Sending…" : "Start free →"}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  )
}

const INSIDE_ROWS: [string, string, string][] = [
  ["emp", "👥 Employees, past and present", "salary, PAN, Aadhaar, bank details"],
  ["cust", "🛒 Customers or students", "name, phone, address — and parents, for a school"],
  ["app", "📄 Applicants and enquiries", "CVs, admission forms, website enquiries nobody deleted"],
  ["vis", "📸 Visitors on CCTV, per month", "footage is personal data the moment a face is identifiable"],
  ["other", "➕ Anyone else", "donors, patients, members, subscribers"],
]
const OUTSIDE_ROWS: [string, string, string][] = [
  ["vend", "🔗 Outside firms that touch your data", "website, hosting, payroll, GPS, accounting software"],
  ["vstaff", "👤 Their staff who can see it, each", "the developer, the payroll clerk, the server admin"],
  ["adv", "📊 CA, CS, legal or audit firms", "they hold your PAN, financials and staff records too"],
]

function Calculator() {
  const [v, setV] = useState({ emp: 120, cust: 4800, app: 600, vis: 300, other: 0, vend: 6, vstaff: 3, adv: 2 })
  const own = v.emp + v.cust + v.app + v.vis + v.other
  const out = v.vend * v.vstaff + v.adv * 2
  const tot = own + out
  const firms = v.vend + v.adv
  const duties = Math.min(40, 12 + Math.round(tot / 400) + v.vend * 2)
  const docs = 7 + (v.vend ? 1 : 0)

  function setField(key: keyof typeof v, raw: string) {
    setV((s) => ({ ...s, [key]: Math.max(0, Number(raw) || 0) }))
  }

  function Row([key, label, sub]: [string, string, string]) {
    return (
      <div key={key} className="grid grid-cols-[1fr_110px] items-center gap-3 border-b border-[#F2EFFB] py-2">
        <div>
          <b className="block text-sm font-semibold">{label}</b>
          <span className="text-xs text-[#8E86AD]">{sub}</span>
        </div>
        <input
          type="number"
          min={0}
          value={v[key as keyof typeof v]}
          onChange={(e) => setField(key as keyof typeof v, e.target.value)}
          className="w-full rounded-lg border-[1.5px] border-[#E6E2F5] px-3 py-2 text-right text-sm"
        />
      </div>
    )
  }

  return (
    <div className="mx-auto mt-5 max-w-[790px] rounded-[20px] border-[1.5px] border-[#E6E2F5] bg-white p-6 text-left shadow-[0_14px_44px_rgba(109,40,217,0.13)]">
      <div className="mb-3 text-center">
        <div className="mb-1 text-sm font-bold uppercase tracking-wide text-[#6D28D9]">DPDP Calculator</div>
        <h3 className="text-xl font-bold">🧮 How much are you actually answerable for?</h3>
        <p className="mt-1 text-sm text-[#564D77]">Most organisations have never counted. Rough numbers are fine — the total is usually the surprise.</p>
      </div>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#6D28D9]">Inside your walls</div>
      {INSIDE_ROWS.map(Row)}
      <div className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-wider text-[#C2410C]">
        Outside your walls — and still your penalty
      </div>
      {OUTSIDE_ROWS.map(Row)}

      <div className="mt-4 rounded-2xl bg-gradient-to-br from-[#F2ECFF] to-[#FCE7F3] p-5 text-center">
        <div className="bg-gradient-to-r from-[#6D28D9] to-[#DB2777] bg-clip-text text-5xl font-extrabold leading-none text-transparent">
          {tot.toLocaleString("en-IN")}
        </div>
        <div className="mt-1 text-sm text-[#564D77]">
          people whose personal data you are answerable for — every one with rights under the Act
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold">{own.toLocaleString("en-IN")} inside your walls</span>
          <span className="rounded-full bg-[#FFEDD5] px-3 py-1 text-xs font-semibold text-[#C2410C]">{out} at firms you do not control</span>
          <span className="rounded-full bg-[#FFE4E9] px-3 py-1 text-xs font-semibold text-[#BE123C]">{firms} need a S.8(2) agreement</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["📋", String(duties), "duties this creates"],
          ["📄", String(docs), "documents to produce"],
          ["🔗", String(firms), "agreements to sign"],
          ["⏱️", "90 / 72", "days to answer · hours to report a leak"],
        ].map(([icon, value, label], i) => (
          <div key={i} className="rounded-xl border border-[#E6E2F5] bg-white p-3 text-center">
            <span className="text-sm">{icon}</span>
            <b className="block text-xl font-extrabold text-[#1F1B3A]">{value}</b>
            <span className="text-[11px] text-[#564D77]">{label}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-xl bg-[#DCFCE7] p-3 text-sm">
        ✅ <b>All {tot.toLocaleString("en-IN")} are handled, and none of them is a login you administer.</b> Every person
        can give consent, withdraw it, see what you hold, correct it and ask you to delete it — through a link, with no account.
      </div>

      <div className="mt-4 border-t border-[#E6E2F5] pt-4">
        <div className="mb-2 text-center text-sm font-semibold">
          See your own numbers on a real data map — free, in fifteen minutes
        </div>
        <EmailCapture />
        <p className="mt-2 text-center text-[11px] text-[#8E86AD]">
          🎟️ No card · 🔑 no password, ever · 🏠 stored in India · 📧 Gmail is fine
          <br />
          <b>One person free forever.</b> You choose a band only when you add a second.
        </p>
      </div>
    </div>
  )
}

export function DpdpMarketingPage() {
  return (
    <div className="min-h-screen bg-[#FCFBFF] text-[#1F1B3A]">
      {/* nav */}
      <header className="sticky top-0 z-20 border-b border-[#E6E2F5] bg-white/90 px-5 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="font-bold leading-tight tracking-tight">
            VERIDIAN
            <span className="ml-1 block text-[8px] font-semibold tracking-[0.2em] text-[#8E86AD]">VERy INDIAN</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-[#8E86AD] sm:inline">Compliance due 13 May 2027</span>
            <Link
              href="#calculator"
              className="rounded-lg bg-gradient-to-r from-[#6D28D9] to-[#DB2777] px-4 py-2 text-sm font-bold text-white hover:opacity-90"
            >
              Start free →
            </Link>
            <Link href="/dpdp/login" className="text-sm font-medium text-[#564D77] hover:text-[#1F1B3A]">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* hero + calculator */}
      <section id="calculator" className="px-5 pb-8 pt-9 text-center">
        <div className="mx-auto mb-4 inline-block rounded-full border border-[#E6E2F5] bg-white px-4 py-1.5 text-xs font-semibold text-[#564D77]">
          ✦ VERIDIAN &nbsp;·&nbsp; <b>VERy INDIAN</b> &nbsp;·&nbsp; an independent, third-party DPDP compliance record
        </div>
        <h1 className="font-heading text-4xl font-extrabold leading-tight sm:text-5xl">
          Your DPDP proof —
          <br />
          <span className="bg-gradient-to-r from-[#6D28D9] to-[#DB2777] bg-clip-text text-transparent">
            not just your DPDP policy.
          </span>
        </h1>
        <div className="mt-3 text-base text-[#564D77]">People move on. The proof stays.</div>
        <Calculator />
      </section>

      {/* penalty schedule band */}
      <div className="bg-[#160F2E] px-5 py-4 text-white">
        <div className="text-center text-xs opacity-80">⚖️ The Schedule to the Act</div>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {PENALTIES.map(([amount, tag]) => (
            <div key={tag} className="rounded-lg bg-white/10 px-3 py-1.5 text-center text-xs">
              <b className="block font-heading text-sm">{amount}</b>
              {tag}
            </div>
          ))}
        </div>
        <div className="mt-2 text-center text-[11px] opacity-65">
          Ceilings per instance · the Board decides under S.33 ·{" "}
          <b className="text-white">no penalty order has been issued in India to date</b>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5">
        {/* features */}
        <section className="py-9">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Everything DPDP, in one place</h2>
          <p className="mt-2 text-center text-sm text-[#564D77]">
            And the two things the law already requires you to publish are free, forever.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="relative overflow-hidden rounded-xl border border-[#E6E2F5] bg-white p-4">
                {f.badge && (
                  <span className="absolute right-3 top-3 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[9px] font-extrabold text-[#059669]">
                    {f.badge}
                  </span>
                )}
                <span className="mb-1.5 block text-xl">{f.icon}</span>
                <b className="block text-sm font-semibold">{f.title}</b>
                <span className="mt-1 block text-xs leading-relaxed text-[#564D77]">{f.body}</span>
              </div>
            ))}
          </div>
        </section>

        {/* what we do / don't */}
        <section className="py-9">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">What we do, and where we stop</h2>
          <p className="mt-2 text-center text-sm text-[#564D77]">Said plainly, because the people selling fear will not.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[#E6E2F5] bg-white p-5">
              <span className="mb-1.5 block text-xl">✅</span>
              <b className="block text-sm font-semibold">We do</b>
              <span className="mt-1 block text-xs leading-relaxed text-[#564D77]">{WE_DO}</span>
            </div>
            <div className="rounded-xl border border-[#E6E2F5] bg-white p-5">
              <span className="mb-1.5 block text-xl">🚫</span>
              <b className="block text-sm font-semibold">We do not</b>
              <span className="mt-1 block text-xs leading-relaxed text-[#564D77]">{WE_DONT}</span>
            </div>
          </div>
        </section>

        {/* segments */}
        <section className="py-9">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Four ways in</h2>
          <p className="mt-2 text-center text-sm text-[#564D77]">
            Pricing after a short conversation, because the right number depends on what you hold.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SEGMENTS.map((s) => (
              <div key={s.title} className="rounded-xl border border-[#E6E2F5] bg-white p-4">
                <span className="mb-1.5 block text-xl">{s.icon}</span>
                <b className="block text-sm font-semibold">{s.title}</b>
                <span className="mt-1 block text-xs leading-relaxed text-[#564D77]">{s.body}</span>
              </div>
            ))}
          </div>
        </section>

        {/* faq */}
        <section className="py-9">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Questions people actually ask</h2>
          <div className="mx-auto mt-6 max-w-2xl space-y-2">
            {FAQ.map(([q, a]) => (
              <div key={q} className="rounded-xl border border-[#E6E2F5] bg-white p-4">
                <b className="block text-sm font-semibold">{q}</b>
                <p className="mt-1 text-xs leading-relaxed text-[#564D77]">{a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* final CTA */}
        <section className="py-9 text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">Start with what you hold</h2>
          <p className="mt-2 text-sm text-[#564D77]">One email. No card. Fifteen minutes.</p>
          <div className="mx-auto mt-4 max-w-[430px]">
            <EmailCapture />
          </div>
        </section>
      </div>

      {/* footer */}
      <footer className="bg-[#160F2E] px-5 py-8 text-center text-white">
        <b className="font-heading text-base">VERIDIAN · VERy INDIAN</b>
        <p className="mx-auto mt-2 max-w-md text-xs text-[#9D94C4]">
          Your DPDP proof — not just your DPDP policy. People move on. The proof stays.
        </p>
        <p className="mt-4 text-xs text-[#9D94C4]">
          Grievance Officer: <b className="text-white">grievance@veridian-aios.com</b> &nbsp;·&nbsp; Partners:{" "}
          <b className="text-white">partners@veridian-aios.com</b>
        </p>
        <p className="mt-2 text-xs text-[#9D94C4]">
          🏠 Stored in India &nbsp;·&nbsp; 🔑 no passwords &nbsp;·&nbsp; 🗄️ we never keep your documents
        </p>
        <p className="mx-auto mt-4 max-w-lg text-[10.5px] text-[#9D94C4]/70">
          We are not a law firm and this is not legal advice. No DPDP certification exists in India and we do not offer
          one. Penalty figures are the Act&apos;s ceilings, decided by the Board under S.33.
        </p>
      </footer>
    </div>
  )
}
