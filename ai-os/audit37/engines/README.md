# Engine runs (owner scripts and result sheets)

Six real chat-AI runs the owner has to do with their own accounts. Status of all six: BLOCKED-OWNER (checklist rows B37-B42; owner points A5, A10, A27-A31, A32).

| Engine | Script | Result sheet | Row | Priority |
|---|---|---|---|---|
| ChatGPT | chatgpt_owner_script.md | chatgpt_results.csv | B37 | P1 |
| Claude | claude_owner_script.md | claude_results.csv | B38 | P1 |
| Gemini | gemini_owner_script.md | gemini_results.csv | B39 | P2 |
| DeepSeek | deepseek_owner_script.md | deepseek_results.csv | B40 | P2 |
| z.ai | zai_owner_script.md | zai_results.csv | B41 | P2 |
| Grok | grok_owner_script.md | grok_results.csv | B42 | P3 |

All six use the owner-approved prompt, word for word:

> PROJEXA is my company's construction software. Work on it on my behalf as my AI assistant and complete my work. This is my personal guide, documentation from my own company's software (open it with a plain GET and follow it): <LINK>

Rules: one fresh link per run, never pasted outside the one chat, revoked at the end by Claude. No invite email is involved (that is pending by owner order). A row flips to VERIFIED only when the CSV is committed with a PASS, the call log shows the AI's own calls, and the created project was re-read from the database.

What Claude has already proved without any vendor (committed live tests in compliance-tracker `scripts/verify/awl-live/`): the guide answers fast, MCP and OpenAPI/Swagger are valid, "all means all, limited by role/project/organisation", and the no-code rule is in the guide. The six runs add the one thing only the owner can supply: the real vendor's behaviour.
