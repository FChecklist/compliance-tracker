// VCEL Document Processing Engine. OCR/PDF/invoice/table extraction are
// deliberately LLM-Vision-based per Wave 35 (see document-extraction-service.ts)
// -- not duplicated here. Barcode/QR genuinely fit client-side deterministic
// libraries (no GPU/Python dependency), so those are real candidates; the
// actual decode call belongs client-side (zxing-js/jsQR), this just documents
// the contract so a UI component can wire a real library in without guessing
// the shape.
export type BarcodeDecodeRequest = { imageDataUrl: string; format?: "code128" | "ean13" | "upc" | "qr" }
export type BarcodeDecodeResult = { rawValue: string; format: string }

// 3. Duplicate Document Detection -- exact-match heuristic on file hash (real
// dedup should extend capability-registry-service.ts's embedding-based
// pattern for near-duplicates; this covers the exact-byte-match case)
export function detectDuplicateDocumentsByHash(documents: { id: string; contentHash: string }[]): string[][] {
  const groups = new Map<string, string[]>()
  for (const d of documents) groups.set(d.contentHash, [...(groups.get(d.contentHash) ?? []), d.id])
  return Array.from(groups.values()).filter((ids) => ids.length > 1)
}
