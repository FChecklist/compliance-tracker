// scripts/static-export-inventory.test.mjs
// bun test --isolate ./scripts/static-export-inventory.test.mjs
//
// Exercises the pure detector functions the inventory script exports
// against small in-memory source snippets -- no filesystem walk, no real
// route files. Complements (does not replace) the real-repo re-run check
// recorded in ai-os/STEP4_STATIC_EXPORT_INVENTORY_2026-09-22.md, which
// confirmed a fresh run against this repo reproduces the committed CSV
// byte-for-byte.

import { describe, expect, test } from "bun:test";
import {
  ROUTE_FILE_RE,
  BLOCKER,
  stripComments,
  readSegmentConfig,
  extractImportSpecs,
  nextHeadersImports,
  exportedHttpMethods,
  requestReads,
  apiFetchTargets,
  veridianCallTargets,
  CSV_COLUMNS,
  toCsv,
} from "./static-export-inventory.mjs";

describe("ROUTE_FILE_RE", () => {
  test("matches page/layout/template/route in supported extensions", () => {
    for (const name of ["page.tsx", "page.ts", "layout.tsx", "template.jsx", "route.ts", "route.mjs", "route.js"]) {
      expect(ROUTE_FILE_RE.test(name)).toBe(true);
    }
  });
  test("rejects everything else", () => {
    for (const name of ["Page.tsx", "page.test.tsx", "loading.tsx", "not-found.tsx", "page.tsx.bak", "component.tsx"]) {
      expect(ROUTE_FILE_RE.test(name)).toBe(false);
    }
  });
});

describe("stripComments", () => {
  test("removes block and line comments but keeps string/regex-adjacent code intact", () => {
    const src = `const a = 1; // export const dynamic = "force-dynamic"\n/* block\nexport const dynamic = "force-static" */\nconst b = "// not a comment";`;
    const out = stripComments(src);
    expect(out).not.toContain("force-dynamic");
    expect(out).not.toContain("force-static");
    expect(out).toContain('"// not a comment"');
  });
});

describe("readSegmentConfig", () => {
  test("reads dynamic/revalidate/runtime exports, unquoting string literals", () => {
    const src = `export const dynamic = "force-dynamic";\nexport const revalidate = 60;\nexport const runtime = 'edge';`;
    const cfg = readSegmentConfig(stripComments(src));
    expect(cfg.dynamic).toBe("force-dynamic");
    expect(cfg.revalidate).toBe("60");
    expect(cfg.runtime).toBe("edge");
  });
  test("a commented-out export is invisible after stripComments", () => {
    const src = `// export const dynamic = "force-dynamic";`;
    const cfg = readSegmentConfig(stripComments(src));
    expect(cfg.dynamic).toBeUndefined();
  });
});

describe("extractImportSpecs", () => {
  test("collects import / export-from / dynamic import / require specifiers", () => {
    const src = [
      `import { foo } from "@/lib/foo";`,
      `import type { Bar } from "@/lib/bar";`,
      `export * from "./reexport";`,
      `const mod = await import("@/lib/dynamic");`,
      `const legacy = require("@/lib/legacy");`,
    ].join("\n");
    const specs = extractImportSpecs(stripComments(src));
    expect(specs).toContain("@/lib/foo");
    expect(specs).toContain("./reexport");
    expect(specs).toContain("@/lib/dynamic");
    expect(specs).toContain("@/lib/legacy");
    // `import type` is excluded by the pattern's negative lookahead
    expect(specs).not.toContain("@/lib/bar");
  });
});

describe("nextHeadersImports", () => {
  test("named imports from next/headers", () => {
    const specs = nextHeadersImports(stripComments(`import { cookies, headers } from "next/headers";`));
    expect(specs.sort()).toEqual(["cookies", "headers"]);
  });
  test("namespace import is recorded as '*'", () => {
    const specs = nextHeadersImports(stripComments(`import * as nh from "next/headers";`));
    expect(specs).toEqual(["*"]);
  });
  test("no next/headers import -> empty", () => {
    expect(nextHeadersImports(stripComments(`import { useState } from "react";`))).toEqual([]);
  });
});

describe("exportedHttpMethods", () => {
  test("exported function declarations", () => {
    const src = `export async function GET(req) {}\nexport function POST() {}`;
    expect(exportedHttpMethods(stripComments(src))).toEqual(["GET", "POST"]);
  });
  test("exported const arrow handlers", () => {
    const src = `export const GET = async (req) => new Response();`;
    expect(exportedHttpMethods(stripComments(src))).toEqual(["GET"]);
  });
  test("re-exported via export { x as GET }", () => {
    const src = `function handler() {}\nexport { handler as GET };`;
    expect(exportedHttpMethods(stripComments(src))).toEqual(["GET"]);
  });
  test("no handler exported -> empty, in a stable method order", () => {
    expect(exportedHttpMethods(stripComments(`export default function Page() { return null; }`))).toEqual([]);
  });
});

describe("requestReads", () => {
  test("detects a member read on the handler's request parameter", () => {
    const src = `export async function POST(request) {\n  const body = await request.json();\n  return new Response();\n}`;
    expect(requestReads(stripComments(src))).toContain("request.json");
  });
  test("NextRequest imported as a VALUE but never read on the handler param is flagged, distinctly", () => {
    // `import type { NextRequest }` is deliberately excluded by the detector
    // (see its own negative lookahead) -- a value import is what's flagged.
    const src = `import { NextRequest } from "next/server";\nexport function GET(req: NextRequest) {\n  return new Response();\n}`;
    const reads = requestReads(stripComments(src));
    expect(reads).toEqual(["NextRequest (typed, no member read detected)"]);
  });
  test("a type-only NextRequest import produces no signal at all", () => {
    const src = `import type { NextRequest } from "next/server";\nexport function GET(req: NextRequest) {\n  return new Response();\n}`;
    expect(requestReads(stripComments(src))).toEqual([]);
  });
  test("no request parameter at all -> empty", () => {
    expect(requestReads(stripComments(`export function GET() { return new Response("ok"); }`))).toEqual([]);
  });
});

describe("apiFetchTargets / veridianCallTargets", () => {
  test("apiFetchTargets keeps only literal or templated /api/ targets", () => {
    const src = `fetch("/api/things");\nfetch(\`\${base}/api/other\`);\nfetch("https://example.com/x");`;
    const targets = apiFetchTargets(stripComments(src));
    expect(targets).toContain("/api/things");
    expect(targets.some((t) => t.includes("/api/other"))).toBe(true);
    expect(targets.some((t) => t.includes("example.com"))).toBe(false);
  });
  test("veridianCallTargets reads the first string argument of callVeridian*", () => {
    const src = `callVeridian("/v1/construction/boq");\ncallVeridianRaw(\`/v1/projexa/\${id}\`);`;
    const targets = veridianCallTargets(stripComments(src));
    expect(targets).toContain("/v1/construction/boq");
    expect(targets.some((t) => t.includes("/v1/projexa/"))).toBe(true);
  });
});

describe("BLOCKER / CSV_COLUMNS / toCsv", () => {
  test("BLOCKER is a non-empty map of blocker codes", () => {
    expect(typeof BLOCKER).toBe("object");
    expect(Object.keys(BLOCKER).length).toBeGreaterThan(0);
  });
  test("toCsv emits the declared header followed by one row per record, quoting fields with commas", () => {
    const rec = Object.fromEntries(CSV_COLUMNS.map((c) => [c, ""]));
    rec.repo = "demo";
    rec.routePath = "/a,b";
    rec.file = "src/app/a/page.tsx";
    const csv = toCsv([rec]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"/a,b"');
  });
});
