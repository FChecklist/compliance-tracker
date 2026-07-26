import { afterEach, describe, expect, test } from "bun:test";
import { detectBuiltinAi, detectCapabilities, detectLiteLlm, detectNpu, detectServer, detectTransformers, detectWebGpu } from "./tier-capabilities";

const realNavigator = globalThis.navigator;
const realLanguageModel = (globalThis as Record<string, unknown>).LanguageModel;

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", { value: realNavigator, configurable: true, writable: true });
  (globalThis as Record<string, unknown>).LanguageModel = realLanguageModel;
});

describe("tier-capabilities", () => {
  test("detectNpu is false when navigator.ml is absent", () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    expect(detectNpu().available).toBe(false);
  });

  test("detectNpu is true when navigator.ml is present", () => {
    Object.defineProperty(globalThis, "navigator", { value: { ml: {} }, configurable: true, writable: true });
    expect(detectNpu().available).toBe(true);
  });

  test("detectBuiltinAi is false with no LanguageModel/window.ai", () => {
    delete (globalThis as Record<string, unknown>).LanguageModel;
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    expect(detectBuiltinAi().available).toBe(false);
  });

  test("detectBuiltinAi is true when global LanguageModel is present", () => {
    (globalThis as Record<string, unknown>).LanguageModel = {};
    expect(detectBuiltinAi().available).toBe(true);
  });

  test("detectWebGpu is false when navigator.gpu is absent", () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    expect(detectWebGpu().available).toBe(false);
  });

  test("detectLiteLlm mirrors WebGPU availability (no WASM fallback for chat-speed LLM inference)", () => {
    expect(detectLiteLlm({ tier: "lite-llm", available: true, reason: "x" }).available).toBe(true);
    expect(detectLiteLlm({ tier: "lite-llm", available: false, reason: "x" }).available).toBe(false);
  });

  test("detectTransformers and detectServer are always available", () => {
    expect(detectTransformers().available).toBe(true);
    expect(detectServer().available).toBe(true);
  });

  test("detectCapabilities assembles a full, consistent report", () => {
    Object.defineProperty(globalThis, "navigator", { value: { ml: {}, gpu: {} }, configurable: true, writable: true });
    (globalThis as Record<string, unknown>).LanguageModel = {};
    const report = detectCapabilities();
    expect(report.npu.available).toBe(true);
    expect(report.builtinAi.available).toBe(true);
    expect(report.webgpu.available).toBe(true);
    expect(report.liteLlm.available).toBe(true);
    expect(report.transformers.available).toBe(true);
    expect(report.server.available).toBe(true);
    expect(typeof report.detectedAt).toBe("number");
  });
});
