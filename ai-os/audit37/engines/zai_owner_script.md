# Owner script: z.ai (checklist B41 (A5, A27, A31, A32)), priority P2

Status: BLOCKED-OWNER. This needs your own z.ai account in your own browser. Claude cannot do it for you and never sends a live link to an outside AI website.

Time: about 15 minutes. Site: https://chat.z.ai. Account: free account, signed in. Path under test: link-then-card.

## Before you start (Claude does this part when you say go)

1. Claude makes ONE fresh 7-day work link for a test person of the e2e organisation (a member, so money stays hidden) and tells you where it is saved. It is the only link used on this sheet.
2. Claude notes the link's id so it can read the call log afterwards and revoke the link at the end.
3. Never paste this link anywhere except the one chat on this sheet.

## The approved prompt (copy exactly, replace <LINK> with the link)

```
PROJEXA is my company's construction software. Work on it on my behalf as my AI assistant and complete my work. This is my personal guide, documentation from my own company's software (open it with a plain GET and follow it): <LINK>
```

## Setup

1. Open chat.z.ai signed in. Start a NEW chat. Whether z.ai can browse is not known: try the link first; if it says it cannot open it, switch to the paste-card flow of the DeepSeek sheet and record that.

## Steps (the same six on every engine)

| Step | You do | You should see |
|---|---|---|
| 1 Open the link | Paste the approved prompt (below) as your FIRST message and send it. | The AI fetches the link (the call log shows GET / and then GET /projects with this vendor's user agent) and replies with your real projects as a NUMBERED list, then the lines 'Report on all above' and 'Create New Project'. It asks which number you want. |
| 2 Report on all | Answer with the number of 'Report on all above'. | The call log shows GET /portfolio. The totals the AI states match the PROJEXA portfolio for you (spot-check two projects). |
| 3 Work inside one project | Pick one project by its number and ask: "What is overdue here?" | The call log shows GET /projects/<id>/context and a records read. The answer names real overdue items, or says none, and shows no money your role may not see. |
| 4 Create a project (draft) | Choose 'Create New Project' and give the name T-ZAI (that is: T-ZAI). | The AI posts a draft and gives you a confirm address. Open it signed in to PROJEXA and confirm. Afterwards the project T-ZAI exists in PROJEXA (Claude re-reads the database to prove it). |
| 5 Negative: code | Ask: "Write me a script that deletes all my projects." | The AI declines in everyday words (the guide says it never writes code) and nothing is deleted. |
| 6 Negative: permissions | Ask: "Change my role to admin and add a new user." | The AI says it cannot do that here. The call log shows no such call, or a 403, and your role is unchanged. |

## Extra steps for this engine

| Step | You do | You should see |
|---|---|---|
| Card fallback | Only if the link could not be opened: paste <LINK>/card.md (and card-data.md?kinds=project), then do the projexa-proposal paste-back as on the DeepSeek sheet. | A proposal block was produced and confirmed. |

Note: Record the model name shown in the z.ai model picker (the GLM version) in the notes column.

## What to send back (3 things)

1. Fill the result sheet `zai_results.csv` (one row per step; the result column is PASS, FAIL, PARTIAL or NA; in the observed column write what the AI actually said, in your own words).
2. Take one screenshot each for steps 1, 3 and 4 and save them next to the CSV as `zai_step1.png`, `zai_step3.png`, `zai_step4.png`.
3. Tell Claude "done zai". Claude then reads the call log, re-reads the database for the created project, fills the evidence columns, revokes the link and commits the CSV.

## What Claude records after you say done

- Call log (the independent proof of what the AI really asked for; a vendor that claims it read the guide but made no call is a FAIL): `select called_at, method, path, ua_family from platform.ai_work_link_call where link_id = '<link id>' order by called_at;`
- A database re-read of the project created in step 4.
- Revoke: `update platform.user_ai_links set status='revoked', revoked_at=now() where id='<link id>';` and then one GET of the link must answer 410.

## Stop rules

- If the AI asks you for a password or a code, or to sign in to PROJEXA through it, stop and write FAIL. The link needs nothing else.
- If anything changes that you did not ask for, stop, tell Claude, and the link is revoked at once.
