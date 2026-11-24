export const ORG_DIRECT_ENABLED: boolean
export const ORG_DIRECT_REDIRECTS: string[]
export function editionsOffered(enabled?: boolean): ("firm" | "institution")[]
export function editionAllowed(edition: string | null | undefined, enabled?: boolean): boolean
export function sendToPartnerDoor(edition: string | null | undefined, enabled?: boolean): boolean
