#!/usr/bin/env node
// scripts/static-export-inventory.mjs
//
// PROJEXA-COST-001 Step 4 / decision 13 -- a FACTUAL inventory of how far a
// Next.js App Router repo is from `output: 'export'` (Next's static export).
// Zero dependencies, Node ESM. Runs on this repo (compliance-tracker) and on
// FChecklist/projexa unchanged; both were used to produce the CSVs under
// ai-os/step4-static-export-inventory-*.csv.
//
//   node scripts/static-export-inventory.mjs [--repo <path>] [--csv <out>] [--json <out>]
//
// It walks `src/app/**` (or `app/**`) and, for every page/layout/template/
// route file, records the detectors listed in the CSV header below, then
// classifies each file against the "Unsupported Features" list in Next's own
// bundled guide (node_modules/next/dist/docs/01-app/02-guides/static-exports.md):
//
//   - Dynamic Routes with `dynamicParams: true`
//   - Dynamic Routes without `generateStaticParams()`
//   - Route Handlers that rely on Request
//   - Cookies / Rewrites / Redirects / Headers / Proxy / ISR / Image
//     Optimization (default loader) / Draft Mode / Server Actions /
//     Intercepting Routes
//
// HOW "EXPORTABLE" IS DECIDED (per file, then inherited):
//   own blockers      -- what THIS file does (direct next/headers import,
//                        'use server', bare redirect() in a server component,
//                        dynamic = 'force-dynamic' / revalidate = 0, ISR
//                        revalidate > 0, dynamicParams = true, a server page
//                        reading its `searchParams` prop, unstable_noStore()/
//                        connection(), after(), a dynamic segment with no
//                        generateStaticParams covering it).
//   transitive        -- the file imports (through any depth of first-party
//                        modules, `@/` alias + relative paths; node_modules is
//                        never entered) a module that imports `next/headers`
//                        or is a `'use server'` file. Also: importing
//                        `next-intl/server` when the repo's next-intl request
//                        config (src/i18n/request.ts) itself reads
//                        `next/headers` -- that config is invoked by
//                        getLocale()/getMessages()/getTranslations(), not
//                        imported, so an import walk alone cannot see it.
//   inherited         -- every layout/template above a page renders with it,
//                        so their own+transitive blockers apply to the page.
//   force-static      -- Next 16.3.4's own source (dist/server/request/
//                        cookies.js:33, headers.js:32, search-params.js:158)
//                        returns EMPTY values for cookies()/headers()/
//                        searchParams when `workStore.forceStatic` is set, so a
//                        page under `export const dynamic = 'force-static'`
//                        (its own or an ancestor layout's) is NOT blocked by a
//                        cookie/header/searchParams read -- it is recorded as
//                        `neutralizedByForceStatic` instead. Server actions,
//                        redirects, ISR and missing generateStaticParams are
//                        not neutralized by force-static.
//   route handlers    -- exportable only when the ONLY exported verb is GET,
//                        `dynamic = 'force-static'` is exported (the guide says
//                        this must be explicit), and the handler never reads
//                        the incoming request.
//
// KNOWN LIMITS (stated, not hidden):
//   - Regex-level, not a TypeScript parser. Comments are stripped first
//     (block + line, string-aware) so commented-out `redirect(` does not
//     count, but a regex literal containing `//`, or an unescaped apostrophe
//     in JSX text, can confuse the stripper for the rest of that line/span.
//   - Re-exported pages (`export { default } from ...`) and route handlers
//     with no detectable verb are listed under `unclassified` in the JSON.
//   - A transitive next/headers hit means the import chain REACHES a module
//     that imports next/headers; whether the render actually calls it is a
//     runtime question this script does not answer.
//   - `fetch(` target extraction only sees literal / template-literal first
//     arguments that begin with `/api/` or `${...}/api/`.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const ROUTE_FILE_RE = /^(page|layout|template|route)\.(tsx|ts|jsx|js|mjs)$/;
const CODE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "out", "dist"]);
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const MAX_IMPORT_DEPTH = 12;

export const BLOCKER = {
  // the five headline categories from the Step 4 brief
  DYNAMIC_SEGMENT_NO_GSP: "DYNAMIC_SEGMENT_NO_GSP",
  NEXT_HEADERS: "NEXT_HEADERS",
  SERVER_ACTION: "SERVER_ACTION",
  REDIRECT_IN_SERVER_COMPONENT: "REDIRECT_IN_SERVER_COMPONENT",
  FORCE_DYNAMIC: "FORCE_DYNAMIC",
  // transitive forms of the same
  NEXT_HEADERS_TRANSITIVE: "NEXT_HEADERS_TRANSITIVE",
  SERVER_ACTION_TRANSITIVE: "SERVER_ACTION_TRANSITIVE",
  // the rest of Next's own unsupported list + dynamic APIs
  ISR_REVALIDATE: "ISR_REVALIDATE",
  DYNAMIC_PARAMS_TRUE: "DYNAMIC_PARAMS_TRUE",
  SEARCH_PARAMS_PROP: "SEARCH_PARAMS_PROP",
  NO_STORE_OR_CONNECTION: "NO_STORE_OR_CONNECTION",
  AFTER: "AFTER",
  // route-handler specific
  NON_GET_METHOD: "NON_GET_METHOD",
  READS_REQUEST: "READS_REQUEST",
  NOT_FORCE_STATIC: "NOT_FORCE_STATIC",
};

// blockers that force-static neutralizes (see header)
const FORCE_STATIC_NEUTRALIZES = new Set([
  BLOCKER.NEXT_HEADERS,
  BLOCKER.NEXT_HEADERS_TRANSITIVE,
  BLOCKER.SEARCH_PARAMS_PROP,
  BLOCKER.NO_STORE_OR_CONNECTION,
]);

// ---------------------------------------------------------------------------
// source helpers
// ---------------------------------------------------------------------------

/** Strip // and /* *\/ comments; keeps string contents intact. */
export function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  const isWord = (ch) => /[A-Za-z0-9_$]/.test(ch);
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "`" || c === "'") {
      // an apostrophe directly after a word character is JSX prose
      // ("Don't"), not a string delimiter
      if (c === "'" && i > 0 && isWord(src[i - 1])) {
        out += c;
        i++;
        continue;
      }
      const q = c;
      out += c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") {
          out += src[i];
          i++;
        }
        if (i < n) {
          out += src[i];
          i++;
        }
      }
      if (i < n) {
        out += q;
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function firstStatementDirective(stripped) {
  const m = stripped.match(/^\s*(?:['"]use (client|server)['"]\s*;?\s*)/);
  return m ? m[1] : null;
}

function unquote(v) {
  const t = v.trim().replace(/;$/, "").trim();
  const m = t.match(/^['"`](.*)['"`]$/);
  return m ? m[1] : t;
}

/** `export const dynamic = 'force-static'` style segment config values. */
export function readSegmentConfig(stripped) {
  const cfg = {};
  const re = /\bexport\s+const\s+(dynamic|revalidate|runtime|fetchCache|dynamicParams|preferredRegion|maxDuration)\b\s*(?::[^=]+?)?=\s*([^;\n]+)/g;
  let m;
  while ((m = re.exec(stripped))) {
    cfg[m[1]] = unquote(m[2]);
  }
  return cfg;
}

/** import/export-from/dynamic import/require specifiers, minus `import type`. */
export function extractImportSpecs(stripped) {
  const specs = new Set();
  const patterns = [
    /\bimport\s+(?!type\s)(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(stripped))) specs.add(m[1]);
  }
  return [...specs];
}

export function nextHeadersImports(stripped) {
  const names = new Set();
  const named = /\bimport\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]next\/headers['"]/g;
  let m;
  while ((m = named.exec(stripped))) {
    for (const raw of m[1].split(",")) {
      const part = raw.trim().replace(/^type\s+/, "");
      if (!part) continue;
      names.add(part.split(/\s+as\s+/)[0].trim());
    }
  }
  if (/\bimport\s+\*\s+as\s+\w+\s+from\s*['"]next\/headers['"]/.test(stripped)) names.add("*");
  return [...names];
}

function importsFrom(stripped, moduleName) {
  const esc = moduleName.replace(/[/.]/g, (c) => "\\" + c);
  return new RegExp(`\\bfrom\\s*['"]${esc}['"]|\\bimport\\s*['"]${esc}['"]`).test(stripped);
}

function namedImportsFrom(stripped, moduleName) {
  const esc = moduleName.replace(/[/.]/g, (c) => "\\" + c);
  const re = new RegExp(`\\bimport\\s*(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${esc}['"]`, "g");
  const names = new Set();
  let m;
  while ((m = re.exec(stripped))) {
    for (const raw of m[1].split(",")) {
      const part = raw.trim().replace(/^type\s+/, "");
      if (part) names.add(part.split(/\s+as\s+/)[0].trim());
    }
  }
  return names;
}

export function exportedHttpMethods(stripped) {
  const found = new Set();
  for (const verb of HTTP_METHODS) {
    const fn = new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${verb}\\b`);
    const konst = new RegExp(`\\bexport\\s+(?:const|let|var)\\s+${verb}\\b`);
    if (fn.test(stripped) || konst.test(stripped)) found.add(verb);
  }
  // export { handler as GET, other as POST } [from '...']
  const braces = /\bexport\s*\{([^}]*)\}/g;
  let m;
  while ((m = braces.exec(stripped))) {
    for (const raw of m[1].split(",")) {
      const part = raw.trim();
      if (!part) continue;
      const exported = part.includes(" as ") ? part.split(/\s+as\s+/)[1].trim() : part;
      if (HTTP_METHODS.includes(exported)) found.add(exported);
    }
  }
  // export const { GET, POST } = something
  const destructured = /\bexport\s+const\s*\{([^}]*)\}\s*=/g;
  while ((m = destructured.exec(stripped))) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s*:\s*/)[0];
      if (HTTP_METHODS.includes(name)) found.add(name);
    }
  }
  return HTTP_METHODS.filter((v) => found.has(v));
}

/** Names of the first parameter of each exported verb handler. */
function handlerRequestParamNames(stripped) {
  const names = new Set();
  const verbs = HTTP_METHODS.join("|");
  const fn = new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+(?:${verbs})\\s*\\(\\s*(?:\\{[^}]*\\}|([A-Za-z_$][\\w$]*))`, "g");
  let m;
  while ((m = fn.exec(stripped))) if (m[1]) names.add(m[1]);
  const arrow = new RegExp(`\\bexport\\s+const\\s+(?:${verbs})\\s*=\\s*(?:async\\s*)?\\(\\s*(?:\\{[^}]*\\}|([A-Za-z_$][\\w$]*))`, "g");
  while ((m = arrow.exec(stripped))) if (m[1]) names.add(m[1]);
  return [...names];
}

export function requestReads(stripped) {
  const reads = new Set();
  const paramNames = handlerRequestParamNames(stripped);
  const candidates = new Set(["req", "request", ...paramNames]);
  for (const name of candidates) {
    if (name === "_" || name.startsWith("_")) {
      // conventionally-unused parameter; still check for real member reads
    }
    const esc = name.replace(/\$/g, "\\$");
    const member = new RegExp(`\\b${esc}\\.(json|formData|text|arrayBuffer|blob|headers|cookies|nextUrl|url|body|method|signal|geo|ip)\\b`, "g");
    let m;
    while ((m = member.exec(stripped))) reads.add(`${name}.${m[1]}`);
    if (new RegExp(`new\\s+URL\\(\\s*${esc}\\.url`).test(stripped)) reads.add(`new URL(${name}.url)`);
    // request object handed to a helper (requireAuth(request), withTiming(req), ...)
    const passed = new RegExp(`[(,]\\s*${esc}\\s*[,)]`, "g");
    if (paramNames.includes(name) && passed.test(stripped)) reads.add(`${name} passed to helper`);
  }
  if (/\bNextRequest\b/.test(stripped) && !/\bimport\s+type\s*\{[^}]*NextRequest/.test(stripped) && reads.size === 0) {
    // NextRequest imported as a value but never read -- record the signal only
    reads.add("NextRequest (typed, no member read detected)");
  }
  return [...reads];
}

export function apiFetchTargets(stripped) {
  const targets = [];
  const re = /\bfetch\(\s*(['"`])((?:\$\{[^}]*\}|(?:(?!\1)[^]))*)\1/g;
  let m;
  while ((m = re.exec(stripped))) {
    const t = m[2];
    if (t.startsWith("/api/") || /^\$\{[^}]*\}\/api\//.test(t)) targets.push(t);
  }
  return [...new Set(targets)];
}

/** `callVeridian*("...")` first-argument literals (PROJEXA's upstream client). */
export function veridianCallTargets(stripped) {
  const targets = [];
  const re = /\bcallVeridian(?:Raw|Result|Binary|Upload)?\s*(?:<[^>]*>)?\s*\(\s*(['"`])((?:\$\{[^}]*\}|(?:(?!\1)[^]))*)\1/g;
  let m;
  while ((m = re.exec(stripped))) targets.push(m[2]);
  return [...new Set(targets)];
}

function bareCallCount(stripped, fnName) {
  // not preceded by `.` (NextResponse.redirect) or a word char
  const re = new RegExp(`(?<![.\\w$])${fnName}\\s*\\(`, "g");
  return (stripped.match(re) || []).length;
}

function hasGenerateStaticParams(stripped) {
  return /\bexport\s+(?:async\s+)?function\s+generateStaticParams\b/.test(stripped)
    || /\bexport\s+const\s+generateStaticParams\b/.test(stripped)
    || /\bexport\s*\{[^}]*\bgenerateStaticParams\b[^}]*\}/.test(stripped);
}

function readsSearchParamsProp(stripped) {
  // server page: `searchParams` in the default export's props or awaited
  return /\bsearchParams\b/.test(stripped);
}

function isReexportDefault(stripped) {
  return /\bexport\s*\{\s*default\s*\}\s*from\b/.test(stripped)
    || /\bexport\s*\{[^}]*\bas\s+default\b[^}]*\}\s*from\b/.test(stripped)
    || /\bexport\s+\{\s*default\s+as\s+\w+\s*\}/.test(stripped);
}

// ---------------------------------------------------------------------------
// filesystem helpers
// ---------------------------------------------------------------------------

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isFile(p) {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith("_")) continue; // `_x` folders are not routable
      await walk(path.join(dir, e.name), out);
    } else if (e.isFile() && ROUTE_FILE_RE.test(e.name)) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function stripJsonComments(text) {
  return stripComments(text).replace(/,(\s*[}\]])/g, "$1");
}

async function readTsconfigAliases(repoRoot) {
  const aliases = [];
  const tsconfigPath = path.join(repoRoot, "tsconfig.json");
  if (await isFile(tsconfigPath)) {
    try {
      const json = JSON.parse(stripJsonComments(await fs.readFile(tsconfigPath, "utf8")));
      const baseUrl = json?.compilerOptions?.baseUrl ?? ".";
      const paths = json?.compilerOptions?.paths ?? {};
      for (const [key, targets] of Object.entries(paths)) {
        if (!Array.isArray(targets) || targets.length === 0) continue;
        const prefix = key.replace(/\*$/, "");
        const targetPrefix = String(targets[0]).replace(/\*$/, "");
        aliases.push({ prefix, target: path.resolve(repoRoot, baseUrl, targetPrefix) });
      }
    } catch {
      // fall through to the default
    }
  }
  if (!aliases.some((a) => a.prefix === "@/")) {
    const src = path.join(repoRoot, "src");
    aliases.push({ prefix: "@/", target: (await exists(src)) ? src + path.sep : repoRoot + path.sep });
  }
  return aliases;
}

async function resolveModule(spec, fromFile, repoRoot, aliases) {
  let base = null;
  if (spec.startsWith("./") || spec.startsWith("../")) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    for (const a of aliases) {
      if (spec.startsWith(a.prefix)) {
        base = path.join(a.target, spec.slice(a.prefix.length));
        break;
      }
    }
  }
  if (!base) return null; // bare package specifier -> node_modules, never entered
  const candidates = [base];
  if (/\.(js|mjs|cjs)$/.test(base)) {
    candidates.push(base.replace(/\.(js|mjs|cjs)$/, ".ts"), base.replace(/\.(js|mjs|cjs)$/, ".tsx"));
  }
  for (const ext of CODE_EXTS) candidates.push(base + ext);
  for (const ext of CODE_EXTS) candidates.push(path.join(base, "index" + ext));
  for (const c of candidates) {
    if (c.startsWith(repoRoot) && (await isFile(c))) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// module graph (transitive next/headers + 'use server')
// ---------------------------------------------------------------------------

class ModuleGraph {
  constructor(repoRoot, aliases) {
    this.repoRoot = repoRoot;
    this.aliases = aliases;
    this.cache = new Map();
  }

  async scan(abs) {
    if (this.cache.has(abs)) return this.cache.get(abs);
    let src = "";
    try {
      src = await fs.readFile(abs, "utf8");
    } catch {
      const empty = { abs, useClient: false, useServerTop: false, nextHeaders: [], importsNextIntlServer: false, importsServerOnly: false, imports: [] };
      this.cache.set(abs, empty);
      return empty;
    }
    const stripped = stripComments(src);
    const directive = firstStatementDirective(stripped);
    const info = {
      abs,
      useClient: directive === "client",
      useServerTop: directive === "server",
      nextHeaders: nextHeadersImports(stripped),
      importsNextIntlServer: importsFrom(stripped, "next-intl/server"),
      importsServerOnly: importsFrom(stripped, "server-only"),
      imports: [],
    };
    this.cache.set(abs, info); // set before resolving to break cycles
    const specs = extractImportSpecs(stripped);
    for (const spec of specs) {
      const resolved = await resolveModule(spec, abs, this.repoRoot, this.aliases);
      if (resolved && resolved !== abs) info.imports.push(resolved);
    }
    return info;
  }

  /** BFS from `root`; returns the nearest module for each signal (excluding root itself). */
  async transitive(root) {
    const result = { nextHeadersVia: null, useServerVia: null, nextIntlServerVia: null, depthNextHeaders: null, depthUseServer: null };
    const seen = new Set([root]);
    let frontier = [root];
    let depth = 0;
    while (frontier.length && depth < MAX_IMPORT_DEPTH) {
      depth++;
      const next = [];
      for (const file of frontier) {
        const info = await this.scan(file);
        for (const dep of info.imports) {
          if (seen.has(dep)) continue;
          seen.add(dep);
          const depInfo = await this.scan(dep);
          if (!result.nextHeadersVia && depInfo.nextHeaders.length) {
            result.nextHeadersVia = dep;
            result.depthNextHeaders = depth;
          }
          if (!result.useServerVia && depInfo.useServerTop) {
            result.useServerVia = dep;
            result.depthUseServer = depth;
          }
          if (!result.nextIntlServerVia && depInfo.importsNextIntlServer) result.nextIntlServerVia = dep;
          next.push(dep);
        }
      }
      frontier = next;
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// repo-level blockers
// ---------------------------------------------------------------------------

export async function repoLevelBlockers(repoRoot) {
  const out = {
    proxyOrMiddleware: [],
    nextConfig: null,
    i18nRequestConfig: null,
  };
  for (const name of ["src/proxy.ts", "src/proxy.js", "proxy.ts", "proxy.js", "src/middleware.ts", "src/middleware.js", "middleware.ts", "middleware.js"]) {
    const p = path.join(repoRoot, ...name.split("/"));
    if (await isFile(p)) {
      const src = await fs.readFile(p, "utf8");
      out.proxyOrMiddleware.push({ file: name, lines: src.split("\n").length });
    }
  }
  for (const name of ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.cjs"]) {
    const p = path.join(repoRoot, name);
    if (!(await isFile(p))) continue;
    const stripped = stripComments(await fs.readFile(p, "utf8"));
    const m = (re) => re.test(stripped);
    const outputMatch = stripped.match(/\boutput\s*:\s*['"](\w+)['"]/);
    out.nextConfig = {
      file: name,
      output: outputMatch ? outputMatch[1] : null,
      headers: m(/(^|[\s{,])(async\s+)?headers\s*\(\s*\)\s*\{|\bheaders\s*:\s*(async\s*)?(\(|\[|function)/m),
      redirects: m(/(^|[\s{,])(async\s+)?redirects\s*\(\s*\)\s*\{|\bredirects\s*:\s*(async\s*)?(\(|\[|function)/m),
      rewrites: m(/(^|[\s{,])(async\s+)?rewrites\s*\(\s*\)\s*\{|\brewrites\s*:\s*(async\s*)?(\(|\[|function)/m),
      images: m(/\bimages\s*:\s*\{/),
      imagesLoader: (stripped.match(/\bloader\s*:\s*['"](\w+)['"]/) || [])[1] || null,
      i18n: m(/\bi18n\s*:\s*\{/),
      trailingSlash: (stripped.match(/\btrailingSlash\s*:\s*(true|false)/) || [])[1] || null,
      nextIntlPlugin: m(/createNextIntlPlugin/),
      sentry: m(/withSentryConfig/),
    };
    // next-intl request config: explicit path or the documented default
    let requestConfig = null;
    const explicit = stripped.match(/createNextIntlPlugin\(\s*['"]([^'"]+)['"]/);
    const candidates = explicit ? [explicit[1]] : ["./src/i18n/request.ts", "./src/i18n/request.tsx", "./src/i18n/request.js", "./i18n/request.ts", "./i18n/request.js"];
    for (const c of candidates) {
      const p2 = path.resolve(repoRoot, c);
      if (await isFile(p2)) {
        requestConfig = { file: toPosix(path.relative(repoRoot, p2)), readsNextHeaders: nextHeadersImports(stripComments(await fs.readFile(p2, "utf8"))) };
        break;
      }
    }
    out.i18nRequestConfig = requestConfig;
    break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// per-file analysis
// ---------------------------------------------------------------------------

function routeInfo(appDir, abs) {
  const relDir = path.relative(appDir, path.dirname(abs));
  const parts = relDir ? relDir.split(path.sep) : [];
  const urlParts = parts.filter((p) => !/^\(.*\)$/.test(p) && !p.startsWith("@"));
  const dynamicSegments = [];
  parts.forEach((p, idx) => {
    if (/^\[\[\.\.\..+\]\]$/.test(p)) dynamicSegments.push({ seg: p, kind: "optional-catch-all", dirIndex: idx });
    else if (/^\[\.\.\..+\]$/.test(p)) dynamicSegments.push({ seg: p, kind: "catch-all", dirIndex: idx });
    else if (/^\[.+\]$/.test(p)) dynamicSegments.push({ seg: p, kind: "dynamic", dirIndex: idx });
  });
  return {
    routePath: "/" + urlParts.join("/"),
    dirParts: parts,
    dynamicSegments,
    parallelSlot: parts.find((p) => p.startsWith("@")) || null,
  };
}

async function analyzeFile(abs, appDir, repoRoot, graph, repoLevel) {
  const base = path.basename(abs);
  const kind = base.split(".")[0]; // page | layout | template | route
  const src = await fs.readFile(abs, "utf8");
  const stripped = stripComments(src);
  const directive = firstStatementDirective(stripped);
  const useServerCount = (stripped.match(/['"]use server['"]/g) || []).length;
  const useClient = directive === "client";
  const useServerFile = directive === "server";
  const useServerInline = useServerCount - (useServerFile ? 1 : 0) > 0;
  const cfg = readSegmentConfig(stripped);
  const nextServerNames = namedImportsFrom(stripped, "next/server");
  const nextCacheNames = namedImportsFrom(stripped, "next/cache");
  const nextNavNames = namedImportsFrom(stripped, "next/navigation");
  const info = routeInfo(appDir, abs);

  const rec = {
    repo: path.basename(repoRoot),
    kind,
    routePath: info.routePath,
    file: toPosix(path.relative(repoRoot, abs)),
    lines: src.split("\n").length,
    dynamicSegments: info.dynamicSegments.map((d) => d.seg),
    parallelSlot: info.parallelSlot,
    hasGenerateStaticParams: hasGenerateStaticParams(stripped),
    gspCovered: null, // filled in after all layouts are known
    useClient,
    useServerFile,
    useServerInline,
    nextHeadersImports: nextHeadersImports(stripped),
    redirectCalls: bareCallCount(stripped, "redirect") + bareCallCount(stripped, "permanentRedirect"),
    redirectImportedFromNextNavigation: nextNavNames.has("redirect") || nextNavNames.has("permanentRedirect"),
    notFoundCalls: bareCallCount(stripped, "notFound"),
    exportDynamic: cfg.dynamic ?? null,
    exportRevalidate: cfg.revalidate ?? null,
    exportRuntime: cfg.runtime ?? null,
    exportFetchCache: cfg.fetchCache ?? null,
    exportDynamicParams: cfg.dynamicParams ?? null,
    usesUnstableCache: /\bunstable_cache\b/.test(stripped),
    usesAfter: nextServerNames.has("after") && bareCallCount(stripped, "after") > 0,
    usesNoStoreOrConnection: (nextCacheNames.has("unstable_noStore") && bareCallCount(stripped, "unstable_noStore") > 0)
      || (nextCacheNames.has("noStore") && bareCallCount(stripped, "noStore") > 0)
      || (nextServerNames.has("connection") && bareCallCount(stripped, "connection") > 0),
    readsSearchParamsProp: kind !== "route" && !useClient && readsSearchParamsProp(stripped),
    httpMethods: kind === "route" ? exportedHttpMethods(stripped) : [],
    requestReads: kind === "route" ? requestReads(stripped) : [],
    apiFetchTargets: apiFetchTargets(stripped),
    veridianCalls: veridianCallTargets(stripped),
    importsNextIntlServer: importsFrom(stripped, "next-intl/server"),
    reexportDefault: kind !== "route" && isReexportDefault(stripped),
    transitiveNextHeadersVia: null,
    transitiveUseServerVia: null,
    transitiveNextIntlServerVia: null,
    ownBlockers: [],
    inheritedBlockers: [],
    inheritedFrom: [],
    forceStatic: cfg.dynamic === "force-static",
    neutralizedByForceStatic: [],
    exportable: null,
    _abs: abs,
    _dirParts: info.dirParts,
    _dynamic: info.dynamicSegments,
  };

  // transitive walk: always for pages/layouts/templates; for route handlers
  // only when the file is otherwise a static-export candidate
  const routeCandidate = kind === "route" && rec.httpMethods.length === 1 && rec.httpMethods[0] === "GET" && rec.exportDynamic === "force-static";
  if (kind !== "route" || routeCandidate) {
    const t = await graph.transitive(abs);
    if (t.nextHeadersVia) rec.transitiveNextHeadersVia = `${toPosix(path.relative(repoRoot, t.nextHeadersVia))} (depth ${t.depthNextHeaders})`;
    if (t.useServerVia) rec.transitiveUseServerVia = `${toPosix(path.relative(repoRoot, t.useServerVia))} (depth ${t.depthUseServer})`;
    if (t.nextIntlServerVia) rec.transitiveNextIntlServerVia = toPosix(path.relative(repoRoot, t.nextIntlServerVia));
  }
  return rec;
}

function computeOwnBlockers(rec, repoLevel) {
  const b = [];
  const isRoute = rec.kind === "route";
  if (rec._dynamic.length && !rec.gspCovered) b.push(BLOCKER.DYNAMIC_SEGMENT_NO_GSP);
  if (rec.nextHeadersImports.length) b.push(BLOCKER.NEXT_HEADERS);
  if (rec.useServerFile || rec.useServerInline) b.push(BLOCKER.SERVER_ACTION);
  if (!isRoute && !rec.useClient && rec.redirectCalls > 0) b.push(BLOCKER.REDIRECT_IN_SERVER_COMPONENT);
  if (rec.exportDynamic === "force-dynamic" || rec.exportRevalidate === "0") b.push(BLOCKER.FORCE_DYNAMIC);
  if (rec.exportRevalidate !== null && rec.exportRevalidate !== "0" && rec.exportRevalidate !== "false" && /^\d+$/.test(rec.exportRevalidate)) b.push(BLOCKER.ISR_REVALIDATE);
  if (rec.exportDynamicParams === "true") b.push(BLOCKER.DYNAMIC_PARAMS_TRUE);
  if (rec.readsSearchParamsProp) b.push(BLOCKER.SEARCH_PARAMS_PROP);
  if (rec.usesNoStoreOrConnection) b.push(BLOCKER.NO_STORE_OR_CONNECTION);
  if (rec.usesAfter) b.push(BLOCKER.AFTER);
  const i18nReadsHeaders = Boolean(repoLevel?.i18nRequestConfig?.readsNextHeaders?.length);
  if (rec.transitiveNextHeadersVia || (i18nReadsHeaders && (rec.importsNextIntlServer || rec.transitiveNextIntlServerVia))) {
    if (!b.includes(BLOCKER.NEXT_HEADERS)) b.push(BLOCKER.NEXT_HEADERS_TRANSITIVE);
  }
  if (rec.transitiveUseServerVia && !b.includes(BLOCKER.SERVER_ACTION)) b.push(BLOCKER.SERVER_ACTION_TRANSITIVE);
  if (isRoute) {
    if (rec.httpMethods.some((m) => m !== "GET")) b.push(BLOCKER.NON_GET_METHOD);
    if (rec.requestReads.some((r) => !r.startsWith("NextRequest (typed"))) b.push(BLOCKER.READS_REQUEST);
    if (rec.exportDynamic !== "force-static") b.push(BLOCKER.NOT_FORCE_STATIC);
  }
  return b;
}

// ---------------------------------------------------------------------------
// inventory
// ---------------------------------------------------------------------------

async function repoLabel(repoRoot, override) {
  if (override) return override;
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
    if (pkg && typeof pkg.name === "string" && pkg.name) return pkg.name;
  } catch {
    // no package.json -- fall back to the directory name
  }
  return path.basename(repoRoot);
}

export async function inventory(repoRootInput, options = {}) {
  const repoRoot = path.resolve(repoRootInput);
  let appDir = path.join(repoRoot, "src", "app");
  if (!(await exists(appDir))) appDir = path.join(repoRoot, "app");
  if (!(await exists(appDir))) throw new Error(`No src/app or app directory under ${repoRoot}`);

  const label = await repoLabel(repoRoot, options.name);
  const aliases = await readTsconfigAliases(repoRoot);
  const graph = new ModuleGraph(repoRoot, aliases);
  const repoLevel = await repoLevelBlockers(repoRoot);
  const files = await walk(appDir);

  const records = [];
  const unclassified = [];
  for (const abs of files) {
    try {
      const rec = await analyzeFile(abs, appDir, repoRoot, graph, repoLevel);
      rec.repo = label;
      records.push(rec);
    } catch (err) {
      unclassified.push({ file: toPosix(path.relative(repoRoot, abs)), reason: `analysis failed: ${err.message}` });
    }
  }

  // layouts/templates by directory (posix rel dir -> records)
  const wrappersByDir = new Map();
  for (const r of records) {
    if (r.kind === "layout" || r.kind === "template") {
      const key = r._dirParts.join("/");
      if (!wrappersByDir.has(key)) wrappersByDir.set(key, []);
      wrappersByDir.get(key).push(r);
    }
  }
  const ancestorsOf = (rec) => {
    const chain = [];
    for (let i = 0; i <= rec._dirParts.length; i++) {
      const key = rec._dirParts.slice(0, i).join("/");
      for (const w of wrappersByDir.get(key) || []) if (w !== rec) chain.push(w);
    }
    return chain;
  };

  // generateStaticParams coverage: a dynamic segment at dir index k is
  // covered if the file itself exports GSP, or a layout at any directory
  // between that segment (inclusive) and the file's own directory exports it
  for (const r of records) {
    if (!r._dynamic.length) {
      r.gspCovered = true;
      continue;
    }
    if (r.hasGenerateStaticParams) {
      r.gspCovered = true;
      continue;
    }
    const ancestors = ancestorsOf(r).filter((w) => w.kind === "layout" && w.hasGenerateStaticParams);
    r.gspCovered = r._dynamic.every((d) => ancestors.some((w) => w._dirParts.length >= d.dirIndex + 1));
  }

  for (const r of records) r.ownBlockers = computeOwnBlockers(r, repoLevel);

  // inheritance + force-static neutralization. Route handlers never render a
  // layout, so they inherit nothing.
  for (const r of records) {
    const ancestors = r.kind === "route" ? [] : ancestorsOf(r);
    const inheritedForceStatic = ancestors.some((w) => w.exportDynamic === "force-static");
    r.forceStatic = r.forceStatic || (r.kind !== "route" && inheritedForceStatic);
    const inherited = [];
    for (const w of ancestors) {
      for (const bl of w.ownBlockers) {
        if (!inherited.includes(bl)) inherited.push(bl);
      }
      if (w.ownBlockers.length) r.inheritedFrom.push(w.file);
    }
    r.inheritedBlockers = inherited;
    const all = [...new Set([...r.ownBlockers, ...r.inheritedBlockers])];
    if (r.forceStatic && r.kind !== "route") {
      r.neutralizedByForceStatic = all.filter((bl) => FORCE_STATIC_NEUTRALIZES.has(bl));
    }
    const effective = all.filter((bl) => !r.neutralizedByForceStatic.includes(bl));
    r.effectiveBlockers = effective;
    r.exportable = effective.length === 0;
    if (r.kind === "route" && r.httpMethods.length === 0) unclassified.push({ file: r.file, reason: "route handler with no detectable exported HTTP verb (re-export or unusual export shape)" });
    if (r.reexportDefault) unclassified.push({ file: r.file, reason: "page/layout re-exports its default component from another module; detectors only saw the re-export" });
  }

  const summary = summarize(records, repoLevel, unclassified, repoRoot, appDir, label);
  for (const r of records) {
    delete r._abs;
    delete r._dirParts;
    delete r._dynamic;
  }
  return { records, summary };
}

function count(list, pick) {
  const out = {};
  for (const item of list) for (const k of pick(item)) out[k] = (out[k] || 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

function summarize(records, repoLevel, unclassified, repoRoot, appDir, label) {
  const pages = records.filter((r) => r.kind === "page");
  const layouts = records.filter((r) => r.kind === "layout");
  const templates = records.filter((r) => r.kind === "template");
  const routes = records.filter((r) => r.kind === "route");
  const blockedPages = pages.filter((r) => !r.exportable);
  const onlyInherited = blockedPages.filter((r) => r.ownBlockers.filter((b) => !r.neutralizedByForceStatic.includes(b)).length === 0);
  const onlyInheritedNextHeaders = onlyInherited.filter((r) => r.effectiveBlockers.every((b) => b === BLOCKER.NEXT_HEADERS_TRANSITIVE || b === BLOCKER.NEXT_HEADERS));
  const nonGetRoutes = routes.filter((r) => r.httpMethods.some((m) => m !== "GET"));
  const getOnlyRoutes = routes.filter((r) => r.httpMethods.length === 1 && r.httpMethods[0] === "GET");
  return {
    repo: label,
    repoRoot: toPosix(repoRoot),
    appDir: toPosix(path.relative(repoRoot, appDir)),
    generatedAt: new Date().toISOString(),
    totals: { pages: pages.length, layouts: layouts.length, templates: templates.length, routeHandlers: routes.length, files: records.length },
    pages: {
      exportableAsIs: pages.filter((r) => r.exportable).length,
      blocked: blockedPages.length,
      blockedOnlyByInheritedLayoutBlockers: onlyInherited.length,
      blockedOnlyByInheritedNextHeaders: onlyInheritedNextHeaders.length,
      useClient: pages.filter((r) => r.useClient).length,
      forceStatic: pages.filter((r) => r.forceStatic).length,
      withDynamicSegments: pages.filter((r) => r.dynamicSegments.length).length,
      withGenerateStaticParams: pages.filter((r) => r.hasGenerateStaticParams).length,
      dynamicSegmentsWithoutGsp: pages.filter((r) => r.dynamicSegments.length && !r.gspCovered).length,
      ownBlockerBreakdown: count(pages, (r) => r.ownBlockers),
      inheritedBlockerBreakdown: count(pages, (r) => r.inheritedBlockers),
      effectiveBlockerBreakdown: count(pages, (r) => r.effectiveBlockers),
      neutralizedByForceStatic: count(pages, (r) => r.neutralizedByForceStatic),
      withApiFetchTargets: pages.filter((r) => r.apiFetchTargets.length).length,
    },
    layouts: {
      total: layouts.length,
      withOwnBlockers: layouts.filter((r) => r.ownBlockers.length).length,
      ownBlockerBreakdown: count(layouts, (r) => r.ownBlockers),
      files: layouts.map((r) => ({ file: r.file, useClient: r.useClient, ownBlockers: r.ownBlockers, transitiveNextHeadersVia: r.transitiveNextHeadersVia, transitiveUseServerVia: r.transitiveUseServerVia, importsNextIntlServer: r.importsNextIntlServer })),
    },
    routeHandlers: {
      total: routes.length,
      exportableAsIs: routes.filter((r) => r.exportable).length,
      blocked: routes.filter((r) => !r.exportable).length,
      getOnly: getOnlyRoutes.length,
      withNonGetMethods: nonGetRoutes.length,
      forceStatic: routes.filter((r) => r.exportDynamic === "force-static").length,
      forceDynamic: routes.filter((r) => r.exportDynamic === "force-dynamic").length,
      readingRequest: routes.filter((r) => r.requestReads.some((x) => !x.startsWith("NextRequest (typed"))).length,
      methodBreakdown: count(routes, (r) => r.httpMethods),
      blockerBreakdown: count(routes, (r) => r.effectiveBlockers),
      noDetectableMethod: routes.filter((r) => r.httpMethods.length === 0).length,
    },
    repoLevel,
    unclassified,
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export const CSV_COLUMNS = [
  "repo", "kind", "routePath", "file", "lines", "dynamicSegments", "parallelSlot",
  "hasGenerateStaticParams", "gspCovered", "useClient", "useServerFile", "useServerInline",
  "nextHeadersImports", "redirectCalls", "redirectImportedFromNextNavigation", "notFoundCalls",
  "exportDynamic", "exportRevalidate", "exportRuntime", "exportFetchCache", "exportDynamicParams",
  "usesUnstableCache", "usesAfter", "usesNoStoreOrConnection", "readsSearchParamsProp",
  "httpMethods", "requestReads", "apiFetchTargets", "veridianCalls", "importsNextIntlServer",
  "reexportDefault", "transitiveNextHeadersVia", "transitiveUseServerVia", "transitiveNextIntlServerVia",
  "forceStatic", "ownBlockers", "inheritedBlockers", "inheritedFrom", "neutralizedByForceStatic",
  "effectiveBlockers", "exportable",
];

function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = Array.isArray(v) ? v.join("|") : String(v);
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(records) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of records) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { repo: process.cwd(), csv: null, json: null, name: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") args.repo = argv[++i];
    else if (a === "--csv") args.csv = argv[++i];
    else if (a === "--json") args.json = argv[++i];
    else if (a === "--name") args.name = argv[++i];
    else if (a === "--quiet") args.quiet = true;
    else if (a === "--help" || a === "-h") {
      console.log("usage: node scripts/static-export-inventory.mjs [--repo <path>] [--csv <out>] [--json <out>] [--name <label>] [--quiet]");
      process.exit(0);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { records, summary } = await inventory(args.repo, { name: args.name });
  if (args.csv) {
    await fs.mkdir(path.dirname(path.resolve(args.csv)), { recursive: true });
    await fs.writeFile(args.csv, toCsv(records), "utf8");
  }
  const json = JSON.stringify(summary, null, 2);
  if (args.json) {
    await fs.mkdir(path.dirname(path.resolve(args.json)), { recursive: true });
    await fs.writeFile(args.json, json + "\n", "utf8");
  }
  if (!args.quiet) console.log(json);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
