#!/usr/bin/env python3
"""
Faithful Python port of src/lib/task-tightening.ts's validateTightTask()
for the shell-layer dispatch scripts (worker-entrypoint.sh,
doc-worker-entrypoint.sh), which have no access to the TS/DB-backed
original. Deployed 2026-07-20, closing a real gap found in the
"constitution cross-check" audit: the shell fleet was entirely outside
this validation.

Deliberately a PORT, not a reinvention -- same field-check logic, same
placeholder patterns, same ambiguity phrase list, same field-contradiction
detection algorithm, ported line-for-line from the TS original so the two
enforcement points (TS for the app/HTTP dispatch, this for the shell
fleet) apply IDENTICAL rules instead of two similar-but-drifting ones.

Scope note: only validates prompts written in the new labeled-field format
(## OBJECTIVE / ## SCOPE / etc. headers). A prompt with none of these
headers is treated as legacy free-text (pre-existing tasks, dispatched
before this validator existed) and is NOT blocked -- this must never
retroactively fail an already-running task. New task prompts should adopt
the labeled format going forward.
"""
import json
import re
import sys

MIN_FIELD_LENGTH = 10

PLACEHOLDER_PATTERNS = [
    re.compile(r"^(tbd|todo|n/?a|none|null|undefined|xxx+|\.\.\.|fill.?in|same as (above|objective|scope))$", re.IGNORECASE),
    re.compile(r"^\s*$"),
]

AMBIGUITY_PHRASES = [
    "etc.", "and so on", "and so forth", "as appropriate", "as needed",
    "if needed", "if necessary", "when necessary", "handle edge cases",
    "handle appropriately", "figure it out", "use your judgment", "use your judgement",
    "some kind of", "some sort of", "not sure", "we'll see", "tbd later",
]

NEGATION_TRIGGERS = ["do not", "don't", "never", "must not", "should not", "shouldn't", "excluding", "without"]
CONTRADICTION_STOPWORDS = {
    "the", "a", "an", "of", "to", "for", "and", "or", "in", "on", "at", "by", "with",
    "it", "this", "that", "under", "any", "all", "circumstances", "as", "is", "be",
}

VALID_TIERS = ["mechanical", "integrative", "judgment"]

FIELD_HEADER_RE = re.compile(r"^##\s*(OBJECTIVE|SCOPE|SUCCESS_CRITERIA|EXPECTED_OUTPUT|CONSTRAINTS|COMPLEXITY_TIER|KNOWN_CONTEXT)\s*$", re.IGNORECASE | re.MULTILINE)


def is_placeholder(value):
    trimmed = value.strip()
    return any(p.match(trimmed) for p in PLACEHOLDER_PATTERNS)


def detect_ambiguous_language(value):
    lower = value.lower()
    for phrase in AMBIGUITY_PHRASES:
        if phrase in lower:
            return {"detected": True, "matchedPhrase": phrase}
    return {"detected": False}


def content_words(text, limit=None):
    words = [w for w in re.split(r"[^a-z0-9]+", text) if w and w not in CONTRADICTION_STOPWORDS and len(w) > 2]
    return words[:limit] if limit else words


def detect_field_contradiction(task):
    constraint_text = (task.get("constraints") or "").lower()
    if not constraint_text.strip():
        return {"detected": False}
    requirement_text = " ".join(
        v for v in [task.get("objective"), task.get("scope"), task.get("successCriteria"), task.get("expectedOutput")] if v
    ).lower()
    if not requirement_text.strip():
        return {"detected": False}
    requirement_words = set(content_words(requirement_text))

    for trigger in NEGATION_TRIGGERS:
        search_from = 0
        while True:
            idx = constraint_text.find(trigger, search_from)
            if idx == -1:
                break
            after = constraint_text[idx + len(trigger):]
            words = content_words(after, 6)
            if len(words) >= 2:
                matched = [w for w in words if w in requirement_words]
                if len(matched) >= 2 and len(matched) / len(words) >= 0.6:
                    return {"detected": True, "conflictingTerm": " ".join(words)}
            search_from = idx + len(trigger)
    return {"detected": False}


def check_field(value, label, example):
    trimmed = (value or "").strip()
    if not trimmed:
        return {"valid": False, "reason": f"{label} is missing.", "guidance": f'Please add a {label.lower()} before this can proceed. Example: "{example}"'}
    if is_placeholder(trimmed):
        return {"valid": False, "reason": f'{label} is a placeholder, not a real value ("{trimmed}").', "guidance": f'Please replace it with the actual {label.lower()}. Example: "{example}"'}
    if len(trimmed) < MIN_FIELD_LENGTH:
        return {"valid": False, "reason": f'{label} is too short to be actionable ("{trimmed}").', "guidance": f'Could you be a little more specific -- name the concrete file, behavior, or outcome, not just a category? Example: "{example}"'}
    return None


def validate_tight_task(task):
    objective_failure = check_field(task.get("objective"), "Objective", "Document the Leads module end to end")
    if objective_failure:
        return objective_failure

    scope_failure = check_field(task.get("scope"), "Scope", "Only the Leads module of this CRM tenant")
    if scope_failure:
        return scope_failure

    success_failure = check_field(task.get("successCriteria"), "Success criteria", "All 8 documentation points covered, screenshots taken, PROGRESS.md complete")
    if success_failure:
        return success_failure

    output_failure = check_field(task.get("expectedOutput"), "Expected output", "One markdown file per module, committed and pushed")
    if output_failure:
        return output_failure

    for label, key in [("Objective", "objective"), ("Scope", "scope"), ("Success criteria", "successCriteria"), ("Expected output", "expectedOutput")]:
        ambiguity = detect_ambiguous_language(task.get(key) or "")
        if ambiguity["detected"]:
            return {
                "valid": False,
                "reason": f'{label} contains vague, unresolved language ("{ambiguity["matchedPhrase"]}").',
                "guidance": f'Please replace "{ambiguity["matchedPhrase"]}" with the actual decision -- stating exactly what should happen helps avoid leaving it for the model to guess.',
            }

    contradiction = detect_field_contradiction(task)
    if contradiction["detected"]:
        return {
            "valid": False,
            "reason": f'Constraints say not to do "{contradiction["conflictingTerm"]}", but that same thing is required elsewhere in the task.',
            "guidance": "Could you resolve this contradiction before dispatch -- either remove it from Constraints, or remove the requirement from Objective/Scope/Success criteria/Expected output?",
        }

    tier = task.get("complexityTier")
    if not tier:
        return {"valid": False, "reason": "Complexity tier is missing.", "guidance": f"Please set complexityTier to one of: {', '.join(VALID_TIERS)} -- this determines which models are even eligible to receive this task."}
    if tier not in VALID_TIERS:
        return {"valid": False, "reason": f'Complexity tier "{tier}" is not recognized.', "guidance": f"Please use one of: {', '.join(VALID_TIERS)}."}

    if tier != "mechanical":
        known_context_failure = check_field(task.get("knownContext"), "Known context",
                                             "Read task-tightening.ts's existing TightTask type and validateTightTask() before extending them")
        if known_context_failure:
            return {
                "valid": False,
                "reason": f'Complexity tier "{tier}" requires understanding an existing component, but no known context was supplied -- {known_context_failure["reason"]}',
                "guidance": f'Please add knownContext describing what you already know or have read about the existing code or state this task touches. {known_context_failure["guidance"]}',
            }

    return {"valid": True}


def parse_labeled_fields(prompt_text):
    """Extract ## OBJECTIVE / ## SCOPE / etc. sections from a prompt. Returns
    None if no labeled headers are present at all (legacy free-text prompt --
    not this validator's concern, must not be retroactively blocked)."""
    headers = list(FIELD_HEADER_RE.finditer(prompt_text))
    if not headers:
        return None
    fields = {}
    key_map = {
        "OBJECTIVE": "objective", "SCOPE": "scope", "SUCCESS_CRITERIA": "successCriteria",
        "EXPECTED_OUTPUT": "expectedOutput", "CONSTRAINTS": "constraints",
        "COMPLEXITY_TIER": "complexityTier", "KNOWN_CONTEXT": "knownContext",
    }
    for i, m in enumerate(headers):
        name = m.group(1).upper()
        start = m.end()
        end = headers[i + 1].start() if i + 1 < len(headers) else len(prompt_text)
        fields[key_map[name]] = prompt_text[start:end].strip()
    return fields


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"valid": True, "note": "usage: tight_task_validation.py <prompt_file>"}))
        sys.exit(0)
    with open(sys.argv[1]) as f:
        text = f.read()
    fields = parse_labeled_fields(text)
    if fields is None:
        print(json.dumps({"valid": True, "note": "legacy free-text prompt, no labeled fields found -- not validated, not blocked"}))
        sys.exit(0)
    result = validate_tight_task(fields)
    print(json.dumps(result))
    sys.exit(0 if result.get("valid") else 1)
