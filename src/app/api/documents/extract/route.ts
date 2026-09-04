import { NextRequest, NextResponse } from "next/server";
import { documents } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard";
import { eq } from "drizzle-orm";
import { storeEmbedding } from "@/lib/embeddings";
import { evaluateGuardrails, recordGuardrailViolation } from "@/lib/guardrail-engine";
import { registerAllGuardrails, AI_DOCUMENT_EXTRACTION_LEAF } from "@/lib/guardrail-registrations";
import {
  isTextExtractable,
  extractRawTextForMimeType,
  extractComplianceFields,
} from "@/lib/services/document-extraction-service";

registerAllGuardrails();

export async function POST(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  const roleCheck = requireRole(dbUser, "team_member");
  if (roleCheck) return roleCheck;

  try {
    const contentType = request.headers.get("content-type") || "";

    let textContent = "";
    let documentId: string | undefined;
    let fileName = "uploaded-document";

    if (contentType.includes("multipart/form-data")) {
      // Handle file upload
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      documentId = (formData.get("documentId") as string) || undefined;

      if (!file) {
        return NextResponse.json(
          { error: "No file provided" },
          { status: 400 }
        );
      }

      fileName = file.name;

      // For text-based files, read content directly
      if (file.type === "text/plain" || file.name.endsWith(".txt")) {
        textContent = await file.text();
      } else if (isTextExtractable(file.type)) {
        // CRR-034: this used to be a PDF-only branch that never called any
        // real extraction code -- it just wrote a placeholder sentence
        // saying extraction was unavailable, and let that get embedded as if
        // it were the document. isTextExtractable/extractRawTextForMimeType
        // (document-extraction-service.ts) is the same real PDF/Word/
        // PowerPoint/email extraction the upload-time background path
        // already uses (Wave 35/103) -- covers exactly the four mime types
        // CRR-013 widened this org's storage bucket allowlist to accept.
        const buffer = Buffer.from(await file.arrayBuffer());
        try {
          textContent = await extractRawTextForMimeType(file.type, buffer);
        } catch (err) {
          // A real, specific failure (e.g. a scanned PDF with no text
          // layer) -- surface it, don't fall back to a placeholder that
          // would silently get embedded as if it were real content.
          return NextResponse.json(
            { error: err instanceof Error ? err.message : "Text extraction failed" },
            { status: 422 }
          );
        }
      } else {
        // For other file types, use the file name as context
        textContent = `[File: ${file.name}, Type: ${file.type}] — Please provide the document text for extraction.`;
      }
    } else {
      // JSON body: either documentId or direct text
      const body = await request.json();
      documentId = body.documentId;
      textContent = body.text || "";

      if (documentId && !textContent) {
        // RLS-scoped -- 404s if this document belongs to another org.
        const doc = await withTenantContext({ orgId }, (db) =>
          db.query.documents.findFirst({ where: eq(documents.id, documentId!) })
        );
        if (!doc) {
          return NextResponse.json(
            { error: "Document not found" },
            { status: 404 }
          );
        }
        fileName = doc.name;
        // If we have extracted data already, return it
        if (doc.extractedData) {
          return NextResponse.json({
            documentId: doc.id,
            fileName: doc.name,
            extractedData: doc.extractedData,
            source: "cached",
          });
        }
        textContent = `[Document: ${doc.name}] — Text content not available for inline extraction.`;
      }

      if (!textContent || typeof textContent !== "string") {
        return NextResponse.json(
          { error: "Either text or documentId with extractable content is required" },
          { status: 400 }
        );
      }
    }

    // CRR-035: extraction logic (prompt + LLM call) lives in
    // document-extraction-service.ts now, not in this route -- see that
    // file's own extractComplianceFields comment. Behavior/schema unchanged
    // from before this move.
    let extractedData;
    try {
      extractedData = await extractComplianceFields(orgId, textContent);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Extraction failed" },
        { status: 503 }
      );
    }

    // AI Output Validation by Business Rules (VERIDIAN Review Framework):
    // check the AI-generated fields against real deterministic validators
    // (GSTIN/PAN format+checksum, compliance-type enum, plausible amount/
    // date bounds) before they reach the human review form. A violation is
    // surfaced (validationWarning below) and recorded for audit, not a hard
    // 500 -- the extracted fields are still human-reviewed/editable before
    // any compliance item is created (DocumentUploadSection.tsx), so this is
    // a second, independent check layered on top of that review, not a
    // replacement for it.
    const outputCheck = evaluateGuardrails(AI_DOCUMENT_EXTRACTION_LEAF, "output", extractedData as unknown as Record<string, unknown>);
    if (!outputCheck.passed) {
      void recordGuardrailViolation(documentId ?? `upload-${fileName}`, AI_DOCUMENT_EXTRACTION_LEAF, "output", outputCheck);
    }

    await withTenantContext({ orgId }, async (db) => {
      // Store extracted data in document if we have a documentId
      // (RLS ensures this can only affect a document in this org)
      if (documentId) {
        await db
          .update(documents)
          .set({ extractedData: extractedData as unknown as Record<string, unknown> })
          .where(eq(documents.id, documentId!));
      }
    });

    // Generate and store embedding for the document text
    try {
      const embedContent = `${extractedData.title || fileName}. ${extractedData.description || ""} ${extractedData.complianceType || ""} ${extractedData.authority || ""} ${textContent.slice(0, 500)}`;
      await storeEmbedding(
        "document",
        documentId || `upload-${Date.now()}`,
        embedContent,
        orgId
      );
    } catch (err) {
      console.warn("Failed to store document embedding:", err);
    }

    return NextResponse.json({
      documentId,
      fileName,
      extractedData,
      validationWarning: outputCheck.passed ? null : outputCheck.guidance,
      source: "ai",
    });
  } catch (error) {
    console.error("Document extraction error:", error);
    const message =
      error instanceof Error ? error.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
