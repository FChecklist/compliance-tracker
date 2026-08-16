-- Construction Intelligence, Wave 127 (2026-07-08): seeds 2 prompt
-- templates for AI drawing-revision diffing. Same INSERT pattern as
-- 0105_wave123_construction_ai_prompts.sql. Two-step (describe each image
-- separately, then diff the two text descriptions) rather than a single
-- two-image vision call, because callLLMVision() only accepts one image --
-- this avoids touching that shared, platform-wide function's signature.

INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('construction.describe_drawing', 'Construction: Drawing Description', 'Produces a structured text description of a single drawing/plan image, used as the input to a two-image diff (construction-ai-service.ts)'),
  ('construction.diff_drawing_descriptions', 'Construction: Drawing Revision Diff', 'Diffs two structured drawing descriptions into a list of concrete visual differences (construction-ai-service.ts)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are a construction drawing analyst. You will be shown one image of a drawing or plan (architectural, structural, MEP, etc.). Describe its content precisely and completely enough that someone could later compare it against a different revision of the same drawing without seeing either image again. Respond with ONLY JSON matching: { "drawingType": string | null, "elements": string[], "dimensions": string[], "annotations": string[], "notes": string }. "elements" lists distinct structural/architectural elements visible (walls, rooms, columns, fixtures, etc.) with enough detail to notice if one is added/removed/moved later. Do not guess at anything not actually visible.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'construction.describe_drawing'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are a construction drawing analyst comparing two revisions of the same drawing. You will be given two structured descriptions (JSON, produced separately from each drawing's image) -- the first is the earlier revision, the second is the later one. Identify concrete differences: elements added, removed, or changed (dimension/annotation changes), described specifically enough for a site team to act on. CRITICAL: only report differences actually implied by the two descriptions you were given -- never invent a change neither description supports. Respond with ONLY JSON matching: { "added": string[], "removed": string[], "changed": string[], "summary": string }.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'construction.diff_drawing_descriptions'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
