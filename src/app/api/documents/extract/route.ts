import { NextRequest, NextResponse } from "next/server";
import { documents } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { eq } from "drizzle-orm";
import { resolveModelConfig } from "@/lib/orchestra-model-resolver";
import { callLLMJson } from "@/lib/llm-client";
import { storeEmbedding } from "@/lib/embeddings";
import { evaluateGuardrails, recordGuardrailViolation } from "@/lib/guardrail-engine";
import { registerAllGuardrails, AI_DOCUMENT_EXTRACTION_LEAF } from "@/lib/guardrail-registrations";

registerAllGuardrails();

const EXTRACTION_PROMPT = `You are a compliance document extraction AI for Indian regulatory filings. Extract structured information from the document text provided.

Analyze the text and return a JSON object with the following fields (use null for fields you cannot determine):

{
  "noticeNumber": "The notice/challan/reference number if found",
  "authority": "The issuing authority (e.g., CGST, ITD, EPFO, MCA, State GST, etc.)",
  "demandAmount": "The demand/tax/penalty amount as a number, or null",
  "pan": "PAN number if found (10-char alphanumeric)",
  "gstin": "GSTIN if found (15-char alphanumeric starting with digits)",
  "arn": "Acknowledgement Reference Number if found",
  "period": "The tax period (e.g., 'March 2025', 'Q4 FY2024-25', 'FY 2024-25')",
  "dueDate": "Due date in ISO 8601 format (YYYY-MM-DD) if found, or null",
  "complianceType": "One of: GST, TDS, PF, ESIC, INCOME_TAX, MCA, ROC, LABOUR, ENVIRONMENTAL, OTHER",
  "description": "A brief 1-2 sentence summary of the document content",
  "title": "A short title for this document/compliance item"
}

Rules:
- Be precise with numbers and dates
- Default complianceType to "OTHER" if you cannot determine it
- For demandAmount, extract only the numeric value without currency symbols
- Return ONLY the JSON object, no additional text`;

interface ExtractedFields {
  noticeNumber: string | null;
  authority: string | null;
  demandAmount: number | null;
  pan: string | null;
  gstin: string | null;
  arn: string | null;
  period: string | null;
  dueDate: string | null;
  complianceType: string | null;
  description: string | null;
  title: string | null;
}

export async function POST(request: NextRequest) {
  const { response, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

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
      } else if (file.type === "application/pdf") {
        // Wave 103 (end-to-end testing pass): the old code here base64'd the
        // PDF and sent it as an image_url to Groq's decommissioned
        // llama-3.2-90b-vision-preview -- doubly broken (GROQ_API_KEY was
        // never configured in production, and vision chat endpoints accept
        // images, not PDFs), so this branch never once produced text. The
        // honest behavior is the fallback message the old catch already had;
        // image-based extraction lives in document-extraction-service.ts
        // (Wave 76), and tabular PDF import lives in /api/ingest.
        textContent = `[PDF file: ${file.name}] — Text extraction unavailable. Please provide document text directly.`;
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

    // Wave 103: previously called callGroqLLMJson (hardcoded GROQ_API_KEY,
    // never configured in production -- this whole route was dead on
    // arrival). Routed through the same org-aware resolver every other AI
    // call site uses: org BYOK config wins, else the platform's OpenRouter
    // default, with callLLM's built-in retry + fallback (Wave 72).
    const modelConfig = await resolveModelConfig(orgId, "customer_account_oa");
    if (!modelConfig) {
      return NextResponse.json(
        { error: "No AI model configured for document extraction. Configure one in Settings -> AI Configuration." },
        { status: 503 }
      );
    }
    const { data: extractedData } = await callLLMJson<ExtractedFields>(
      modelConfig.provider,
      modelConfig.model,
      modelConfig.apiKey,
      EXTRACTION_PROMPT,
      textContent.slice(0, 12000), // Truncate to avoid token limits
      { temperature: 0.1, maxTokens: 2048 },
      modelConfig.fallback
    );

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
