export type HomeCopy = {
  eyebrow: string; h1: string; lead: string; lead2: string
  cta: { label: string; href: string }; ctaNote: string; signIn: { label: string; href: string }
  under: string[]; strip: string[]; wordsTitle: string; words: { word: string; meaning: string }[]
  weekly: { title: string; text: string }; stepsTitle: string; steps: { title: string; text: string }[]
  partnersTitle: string; partners: { name: string; text: string }[]; accountantLine: string; orgDoor: { href: string; label: string; sub: string; cta: string }
  terms: { before: string; label: string; href: string; after: string }
}
export const HOME_COPY: HomeCopy
export const HOME_BEGIN: string
export const HOME_END: string
export function renderHome(c?: HomeCopy, orgDirect?: boolean): string
export function applyHome(html: string, c?: HomeCopy, orgDirect?: boolean): string
