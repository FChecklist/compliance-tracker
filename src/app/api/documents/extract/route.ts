import { NextRequest, NextResponse } from "next/server";
import { documents } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { eq } from "drizzle-orm";
import { callGroqLLMJson, getGroqApiKey } from "@/lib/groq";
import { storeEmbedding } from "@/lib/embeddings";

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
        // For PDFs, attempt to extract text
        try {
          // Convert to ArrayBuffer then to base64 for Groq vision
          const arrayBuffer = await file.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");

          // Try using Groq's vision capability to extract text from the PDF
          const apiKey = getGroqApiKey();
          if (apiKey) {
            const visionRes = await fetch(
              "https://api.groq.com/openai/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: "llama-3.2-90b-vision-preview",
                  messages: [
                    {
                      role: "user",
                      content: [
                        {
                          type: "text",
                          text: "Extract ALL text content from this document image. Return only the raw text content, preserving structure and formatting as much as possible.",
                        },
                        {
                          type: "image_url",
                          image_url: {
                            url: `data:application/pdf;base64,${base64}`,
                          },
                        },
                      ],
                    },
                  ],
                  temperature: 0.1,
                  max_tokens: 4096,
                }),
              }
            );

            if (visionRes.ok) {
              const visionData = await visionRes.json();
              textContent =
                visionData.choices[0].message.content || "";
            }
          }
        } catch (err) {
          console.warn("PDF text extraction failed:", err);
          textContent = `[PDF file: ${file.name}] — Text extraction unavailable. Please provide document text directly.`;
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

    // Call Groq LLM to extract fields
    const extractedData = await callGroqLLMJson<ExtractedFields>(
      EXTRACTION_PROMPT,
      textContent.slice(0, 12000), // Truncate to avoid token limits
      { temperature: 0.1, maxTokens: 2048 }
    );

    await withTenantContext({ orgId }, async (db) => {
      // Store extracted data in document if we have a documentId
      // (RLS ensures this can only affect a document in this org)
      if (documentId) {
        await db
          .update(documents)
          .set({ extractedData: extractedData as Record<string, unknown> })
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
      source: "ai",
    });
  } catch (error) {
    console.error("Document extraction error:", error);
    const message =
      error instanceof Error ? error.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
