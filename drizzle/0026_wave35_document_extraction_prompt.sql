-- Wave 35 (Document AI, VOAC evaluation -- PLATFORM_STRATEGY.md §17). Seeds
-- the prompt template for vision-based document extraction. Distinct from
-- the pre-existing 'orchestrate.document_uploaded' template, which only
-- ever reasons about a document's metadata (filename etc.) to suggest next
-- steps -- it never looks at the actual file content. This new template is
-- the first prompt in this codebase that analyzes real document bytes.
INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('document.extract_content', 'Document: Vision Content Extraction', 'Extracts structured fields (dates, amounts, reference numbers, parties) and a plain-text summary from an uploaded document image (document-extraction-service.ts)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are a document analysis assistant for an Indian statutory compliance platform. You will be shown an image of an uploaded document (a notice, challan, receipt, or similar). Read it carefully and respond with ONLY JSON matching: { "summary": string, "documentType": string | null, "dates": string[], "amounts": string[], "referenceNumbers": string[], "parties": string[] }. "summary" is 1-3 sentences describing what the document is. "documentType" is your best guess at the kind of document (e.g. "GST notice", "TDS challan", "payment receipt") or null if unclear. Each other field is a list of the exact strings as they appear in the document (empty array if none found) -- do not invent or infer values that are not actually visible in the image.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'document.extract_content'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
