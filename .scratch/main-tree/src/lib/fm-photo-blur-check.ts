// VERI FM & CS AI OS -- client-side pre-check before a register photo is
// uploaded and sent to parseAndExtractFromPhoto() (fm-register-digitization-service.ts).
// A blurry photo wastes an LLM vision call and produces low-confidence
// extraction rows a reviewer then has to reject, so we catch it for free in
// the browser first. Deliberately classical (Laplacian variance), not a
// trained model: no license to track, no wasm/model download, and it is the
// textbook-correct tool for "is this specific photo sharp enough," unlike a
// general blur/sharp classifier trained on unrelated images (see the
// litert-spike/ directory for why that path was rejected for this use case).
export type GrayscaleImageLike = { data: Uint8ClampedArray; width: number; height: number }

export type BlurCheckResult = { variance: number; isBlurry: boolean }

// Variance-of-Laplacian threshold. There is no universal "correct" value --
// it depends on resolution and subject matter -- so this is a starting
// heuristic tuned for the downscaled (maxDim below) case, not a calibrated
// constant. Treat false positives/negatives as a threshold-tuning task, not
// a bug in the algorithm itself.
const BLUR_VARIANCE_THRESHOLD = 100

/** Pure function: grayscale + convolve with the discrete Laplacian kernel
 *  ([0,1,0; 1,-4,1; 0,1,0]), return the variance of the result. Sharp edges
 *  produce large-magnitude Laplacian responses; a uniformly blurry image
 *  produces small ones clustered near zero, so variance is the signal. */
export function laplacianVariance(image: GrayscaleImageLike): number {
  const { data, width, height } = image
  if (width < 3 || height < 3) return 0

  const gray = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
  }

  let sum = 0
  let sumSq = 0
  let count = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      const lap = gray[idx - 1] + gray[idx + 1] + gray[idx - width] + gray[idx + width] - 4 * gray[idx]
      sum += lap
      sumSq += lap * lap
      count++
    }
  }

  const mean = sum / count
  return sumSq / count - mean * mean
}

/** Browser-only wrapper: decodes the file, downscales it (blur detection
 *  doesn't need full resolution and this keeps the canvas read cheap), and
 *  runs laplacianVariance over the result. */
export async function checkPhotoBlur(file: File | Blob, maxDim = 800): Promise<BlurCheckResult> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("2D canvas context unavailable")
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, width, height)
  const variance = laplacianVariance(imageData)
  return { variance, isBlurry: variance < BLUR_VARIANCE_THRESHOLD }
}
