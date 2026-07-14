/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { laplacianVariance, type GrayscaleImageLike } from "./fm-photo-blur-check"

function solid(width: number, height: number, gray: number): GrayscaleImageLike {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = gray
    data[i * 4 + 1] = gray
    data[i * 4 + 2] = gray
    data[i * 4 + 3] = 255
  }
  return { data, width, height }
}

function checkerboard(width: number, height: number): GrayscaleImageLike {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const v = (x + y) % 2 === 0 ? 0 : 255
      data[i * 4] = v
      data[i * 4 + 1] = v
      data[i * 4 + 2] = v
      data[i * 4 + 3] = 255
    }
  }
  return { data, width, height }
}

describe("laplacianVariance", () => {
  test("is exactly 0 for a perfectly uniform (maximally blurry) image", () => {
    expect(laplacianVariance(solid(20, 20, 128))).toBe(0)
  })

  test("is large for a high-contrast checkerboard (maximally sharp)", () => {
    expect(laplacianVariance(checkerboard(20, 20))).toBeGreaterThan(1000)
  })

  test("a sharper image scores higher than a flatter one", () => {
    const flat = solid(20, 20, 200)
    const sharp = checkerboard(20, 20)
    expect(laplacianVariance(sharp)).toBeGreaterThan(laplacianVariance(flat))
  })

  test("returns 0 for images too small to convolve", () => {
    expect(laplacianVariance(solid(2, 2, 50))).toBe(0)
  })
})
