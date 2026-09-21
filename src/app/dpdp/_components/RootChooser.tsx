import Link from "next/link"

// WO-DPDP-010 §6 "Landing (carried from WO-009, smaller)": veridian-aios.com
// root chooser -- four lines on what DPDP asks, then "I do this for
// clients" (a CA/CS/audit firm -- their own file is the 'firm' product,
// per PROD.firm's own CA-partner role) vs "I do this for us" (a business
// or a school, i.e. firm vs institution). Deliberately small: the detailed
// pitch, features, FAQ and calculator live on /dpdp-firm and
// /dpdp-institution, not duplicated here.
export function RootChooser() {
  return (
    <div className="min-h-screen bg-[#FCFBFF] text-[#1F1B3A] flex items-center justify-center px-5 py-12">
      <div className="max-w-2xl w-full text-center">
        <div className="font-bold leading-tight tracking-tight text-lg mb-8">
          VERIDIAN
          <span className="ml-1 block text-[8px] font-semibold tracking-[0.2em] text-[#8E86AD]">VERy INDIAN</span>
        </div>
        <h1 className="font-heading text-3xl sm:text-4xl font-extrabold leading-tight mb-4">
          The DPDP Act asks every organisation for four things
        </h1>
        <p className="text-base text-[#564D77] mb-2">Know what data you hold. Tell people about it. Keep it safe.</p>
        <p className="text-base text-[#564D77] mb-10">Prove all three — with a record that outlasts the person who set it up.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Link
            href="/dpdp-firm?for=clients"
            className="rounded-2xl border-[1.5px] border-[#E6E2F5] bg-white p-6 text-left hover:border-[#6D28D9] hover:shadow-[0_10px_30px_rgba(109,40,217,0.12)] transition"
          >
            <span className="block text-2xl mb-2">🧑‍⚖️</span>
            <b className="block text-lg font-bold mb-1">I do this for clients</b>
            <span className="block text-sm text-[#564D77]">A CA, CS, audit or legal firm. Your own file is free, always.</span>
          </Link>
          <Link
            href="/dpdp-firm?for=us"
            className="rounded-2xl border-[1.5px] border-[#E6E2F5] bg-white p-6 text-left hover:border-[#6D28D9] hover:shadow-[0_10px_30px_rgba(109,40,217,0.12)] transition"
          >
            <span className="block text-2xl mb-2">🏭</span>
            <b className="block text-lg font-bold mb-1">I do this for us</b>
            <span className="block text-sm text-[#564D77]">A company, NGO or firm of our own.</span>
          </Link>
        </div>
        <Link href="/dpdp-institution" className="mt-4 inline-block text-sm font-medium text-[#6D28D9] hover:underline">
          Running a school instead? →
        </Link>
        <div className="mt-10 text-sm">
          <Link href="/dpdp/login" className="text-[#564D77] hover:text-[#1F1B3A]">Already have an account? Sign in</Link>
        </div>
      </div>
    </div>
  )
}
