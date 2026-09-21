// Port of veridian-dpdp.html's vPolicy() -- every version, current vs
// replaced, fingerprint shown instead of a file (WO §1: "No document
// storage... never the file"). Upload is not wired yet (needs client-side
// hashing before any server action can run) -- read-only for now, flagged
// rather than silently faked with a non-functional button.
export type PolicyVersion = { id: string; filename: string; uploadedAt: Date; uploadedBy: string; sha256: string; current: boolean }

export function PolicySection({ versions }: { versions: PolicyVersion[] }) {
  return (
    <div className="dpdp-onepage">
      <div className="max-w-[1240px] mx-auto px-5 pb-8">
        <div className="mb-3 flex items-baseline gap-3">
          <span style={{ fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 700, color: "var(--dpdp-ink)" }}>📄 DPDP policy</span>
          <span style={{ fontSize: 13, color: "var(--dpdp-ink3)" }}>optional · every version kept</span>
        </div>
        <div className="rounded-[22px] border p-[14px_18px]" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
          {!versions.length ? (
            <p style={{ margin: 0, fontSize: 13 }}>
              <b>No privacy policy uploaded yet.</b> Companies and firms need one under today&rsquo;s law — SPDI R4 ⚡ required today.
            </p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["Version", "File", "Uploaded", "By", "Fingerprint", "Status"].map((h) => (
                      <th key={h} className="text-left" style={{ fontSize: 12, fontWeight: 600, color: "var(--dpdp-ink3)", padding: 12, borderBottom: "1px solid var(--dpdp-line)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...versions].reverse().map((v, i) => (
                    <tr key={v.id} style={v.current ? { background: "#F7FBF8" } : undefined}>
                      <td className="text-center" style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}>v{versions.length - i}</td>
                      <td style={{ fontWeight: 600, padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}>{v.filename}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}>{v.uploadedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)", fontSize: 12.5, color: "var(--dpdp-ink2)" }}>{v.uploadedBy}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)", fontSize: 12.5, color: "var(--dpdp-ink2)", fontFamily: "monospace" }}>{v.sha256.slice(0, 12)}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}>
                        {v.current
                          ? <span className="rounded-lg" style={{ fontSize: 12, fontWeight: 700, padding: "3px 11px", color: "var(--dpdp-g)", border: "1.6px solid var(--dpdp-g)", background: "#fff" }}>Current</span>
                          : <span className="rounded-lg" style={{ fontSize: 12, fontWeight: 700, padding: "3px 11px", background: "var(--dpdp-cL)", color: "var(--dpdp-c)" }}>Replaced</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
