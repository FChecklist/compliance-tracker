import { useEffect, useState } from "react"

// Port of veridian-dpdp.html's seal(done,total) SVG + the .sealsvg/.s-*/
// .sealin CSS rules and the first-paint fill animation (body.first-paint,
// removed after 1.6s). "No arc drawn at 0%" (WO §4 hero description) is
// handled below by only rendering the progress <circle> when pc > 0, exactly
// matching the spec's own `(pc>0 ? ... : '')` ternary.
export function Seal({ done, total }: { done: number; total: number }) {
  const pc = total ? done / total : 0
  const pct = total ? Math.round((done / total) * 100) : 0
  const R = 52
  const C = 2 * Math.PI * R

  const [firstPaint, setFirstPaint] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setFirstPaint(false), 1600)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      className="relative grid place-items-center rounded-[22px] border p-[18px]"
      style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)", minHeight: 236 }}
    >
      <svg viewBox="0 0 160 160" aria-hidden="true" style={{ width: 196, height: 196, display: "block" }}>
        <defs>
          <path id="dpdp-sealpath" d="M80,80 m-67,0 a67,67 0 1,1 134,0 a67,67 0 1,1 -134,0" />
        </defs>
        <circle cx="80" cy="80" r="76" fill="none" stroke="var(--dpdp-v)" strokeWidth="1.6" />
        <circle cx="80" cy="80" r="60" fill="none" stroke="var(--dpdp-line)" strokeWidth="1" />
        <text
          style={{ fontFamily: "Sora, sans-serif", fontSize: "8.6px", fontWeight: 700, letterSpacing: "2.1px" }}
          fill="var(--dpdp-v)"
        >
          <textPath href="#dpdp-sealpath">VERIDIAN ✦ DPDP PROOF ✦ VERY INDIAN ✦ DPDP PROOF ✦</textPath>
        </text>
        <circle cx="80" cy="80" r={R} fill="none" stroke="var(--dpdp-vL)" strokeWidth="9" />
        {pc > 0 && (
          <circle
            cx="80" cy="80" r={R} fill="none" stroke="var(--dpdp-g)" strokeWidth="9" strokeLinecap="round"
            strokeDasharray={`${(C * pc).toFixed(1)} ${C.toFixed(1)}`}
            transform="rotate(-90 80 80)"
            className={firstPaint ? "motion-safe:animate-[dpdp-sealfill_1.2s_cubic-bezier(.2,.8,.2,1)_both]" : undefined}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-content-center pointer-events-none text-center">
        <b style={{ fontFamily: "Sora, sans-serif", fontSize: 28, fontWeight: 800, color: "var(--dpdp-ink)", lineHeight: 1, letterSpacing: "-0.03em" }}>
          {done} of {total}
        </b>
        <span style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", marginTop: 5 }}>{pct}% done</span>
      </div>
    </div>
  )
}
