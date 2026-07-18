# PROGRESS -- task-20260718-053006-ai-architecture--multi-modal---multi-lan

## Completed
- [x] Read governance docs, registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml, checked 4 sibling AI-Architecture branches for file-level overlap (none on the files this task touches)
- [x] Confirmed both findings were still real gaps by reading the current code (not the review framework's original snapshot): llm-client.ts/prompt-os-resolver.ts had zero locale/language wiring anywhere; document-extraction-service.ts's SUPPORTED_MIME_TYPES was still image-only (jpeg/png/webp)
- [x] Multi-Language AI Responses: new `src/lib/ai-response-locale.ts` (20-language directive table + `getPreferredAiResponseLocale()` cookie reader, deliberately decoupled from `src/i18n/locales.ts`'s UI-catalog-constrained en/hi list -- an LLM needs no message catalog to reply in another language, so this doesn't require translating the UI itself)
- [x] Added optional `locale` param to `prompt-os-resolver.ts`'s `resolvePromptTemplate()` (additive, every pre-existing 1-arg call site unaffected) that appends a language directive the same way the existing VERI_PERSONA_DIRECTIVE does
- [x] Wired locale through the real conversational "AI response" surfaces: `chat-service.ts`'s `generateAiReply()` + `generateVeriGroupReply()` (covers VERI Chat 1:1 and group replies, and `regenerateAiReply()` which calls the former), and `help/ask/route.ts` (Help AI)
- [x] Supports Multiple Input Types: extended `document-extraction-service.ts` with a text-extraction path (PDF via `pdf-parse`, Word `.docx` + new PowerPoint `.pptx` via `officecli-client.ts`, best-effort `.eml` email header+body) alongside the existing image-vision path -- `isVisionExtractable()` kept image-only (other services depend on that exact meaning), new `isTextExtractable()` / `isDocumentExtractable()` added
- [x] Added `extractPptxRawText()` to `officecli-client.ts` (refactored the shared tmp-file/query/close logic out of `extractDocxRawText()`) -- verified live against the vendored `bin/officecli-linux-x64` binary (real create/add-slide/add-shape/close/query round-trip) before writing any code depending on it
- [x] Updated `src/app/api/documents/route.ts`'s upload-extraction trigger from `isVisionExtractable` to `isDocumentExtractable`, renamed the `imageBase64` ctx field to `fileBase64` (and the one other caller, `scripts/veridian-full-load-test.ts`) since it now carries non-image file bytes too
- [x] Video explicitly NOT added -- no rasterization/frame-extraction library exists in this codebase or its dependencies, and no provider wired into llm-client.ts accepts raw video over its existing simple-HTTP-JSON vision endpoints; documented in document-extraction-service.ts's header rather than faked
- [x] Tests: `src/lib/ai-response-locale.test.ts` (new), `src/lib/officecli-client.test.ts` (new real .pptx round-trip test using `pptxgenjs`), `src/lib/services/document-extraction-service.test.ts` (new -- mime-type gates, `.eml` parsing, real PDF round-trip via `jspdf` + `pdf-parse`)
- [x] `bunx tsc --noEmit` clean, `bunx eslint` clean on all changed files, `bun test` full suite 1436 pass / 0 fail (2854 expect calls), `bun run build` compiles successfully

## Remaining
- [ ] Open PR against main
