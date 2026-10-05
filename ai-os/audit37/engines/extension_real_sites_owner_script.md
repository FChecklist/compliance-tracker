# Owner script: the browser extension on the REAL chat sites (checklist row B52, owner point A36), priority P2

Status: BLOCKED-OWNER for the real sites. What is already proved without you: the extension loads unpacked in a real Chromium, its popup saves only the link, and its content script fills the message box of fixture pages shaped like each site (committed test `e2e/extension-ai-link.spec.ts` in the PROJEXA repository). What no fixture can prove is that the message box of the REAL site is found, because the sites change their page code. That is what this sheet checks. About 10 minutes, Chrome or Edge.

## Before you start

1. Claude makes one fresh 1-day link for a test person of the e2e organisation and tells you where it is saved. Use only that link.
2. Load the extension once: open `chrome://extensions`, switch on Developer mode, press Load unpacked and choose the folder `extension\projexa-ai-link` of the PROJEXA repository (`C:\ct\projexa\extension\projexa-ai-link`).

## Steps (repeat 3 to 5 on each of ChatGPT, Claude, Gemini, DeepSeek, z.ai)

| Step | You do | You should see |
|---|---|---|
| 1 Save the link | Click the extension icon, paste the link (or the whole prompt), press Save | The word Saved, and the box shows only the link |
| 2 Open the site | Open the chat site signed in and start a NEW chat | An orange PROJEXA button at the bottom right |
| 3 Click it | Click the PROJEXA button | The button says "Prompt + guide added - press send" and the message box now holds the small prompt followed by the guide between the two === lines |
| 4 Send | Press send yourself | The AI answers with your numbered project list |
| 5 Note | Write what happened, with the site's page address and the date | See the CSV |

If step 3 says "No chat box found on this page", that site changed its page: write the site and what the box looks like (for example "the box is a contenteditable with class ..." if you can open the browser inspector, otherwise just a screenshot). Claude then fixes the selector list in `extension/projexa-ai-link/content.js` and the fixture test together.

## What to send back

1. The result sheet `extension_real_sites_results.csv` (one row per site).
2. A screenshot of step 3 for each site named `ext_<site>_step3.png`.
3. Tell Claude "done extension". Claude revokes the link and commits the sheet.

## Stop rules

- If a site asks the extension for a new permission, do not accept it; stop and write FAIL. The extension needs only its one address.
- Never paste the link anywhere except the extension.
