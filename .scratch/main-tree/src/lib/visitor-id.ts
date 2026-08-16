// Shared anonymous visitor identity for the public marketing site. Originally
// lived only in VisitorIntelligence.tsx (Wave 113) -- factored out so
// ContactUsForm can tag its autosave/submit calls with the same visitorId
// without duplicating the localStorage logic.
const VID_KEY = "VERIDIAN_VID"

export function getVisitorId(): string {
  try {
    let vid = localStorage.getItem(VID_KEY)
    if (!vid) {
      vid = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem(VID_KEY, vid)
    }
    return vid
  } catch {
    return `v_ephemeral_${Math.random().toString(36).slice(2, 10)}`
  }
}
