import { useId } from "react"
import { TICK_TO_CONTINUE, type TermsBox } from "@/lib/terms"

/**
 * A ticked box before a commitment (K2 at sign-up, K3 before paying). Never pre-ticked: the parent starts it at false and the database refuses
 * without it anyway. The linked words open in a new tab so the form (and what was typed in it) stays where it is. `describedBy` is the id of the
 * line that says WHY the action is waiting (see TermsWhy); the checkbox is at least 44px to hit.
 */
export function TermsCheckbox({ box, checked, onChange, disabled }: { box: TermsBox; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex gap-2.5 items-start" style={{ fontSize: 14, lineHeight: 1.45, color: "var(--dpdp-ink)", minHeight: 44, alignItems: "center", cursor: disabled ? "default" : "pointer" }}>
      <input
        id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        data-terms-kind={box.kind} style={{ width: 22, height: 22, flex: "none", accentColor: "var(--dpdp-v)" }}
      />
      <span>
        {box.parts.map((p, i) =>
          "href" in p
            ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--dpdp-v)", textDecoration: "underline" }}>{p.text}</a>
            : <span key={i}>{p.text}</span>,
        )}
      </span>
    </label>
  )
}

/** The line beside a waiting button that says why it waits. Shown only while the box is unticked; the button points at it with aria-describedby. */
export function TermsWhy({ id, ticked }: { id: string; ticked: boolean }) {
  if (ticked) return null
  return <p id={id} style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: "var(--dpdp-ink2)" }}>{TICK_TO_CONTINUE}</p>
}
