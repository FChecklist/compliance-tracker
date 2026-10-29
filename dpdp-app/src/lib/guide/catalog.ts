// Guided errors for VERIDIAN DPDP (the signed-in app under /app/).
//
// The rule (owner, 2026-10-22): a person is never left with a bare error. Every mistake or
// failure gets (1) a polite title in plain words, (2) a short explanation, (3) numbered steps,
// (4) a button that takes them to the exact box or heading, and (5) a way back to where they were.
// Nothing here changes a rule, a price or a permission: the database and the functions still decide;
// this file only explains. No technical word is ever shown (src/lib/guide/guide.test.ts lints it).
//
// How each kind is shown (src/components/GuidedError.tsx):
//   "field"       a slip in something typed or chosen        -> in place, the box is outlined and focused
//   "blocked"     the person cannot go on from here          -> in place, with the way forward
//   "wait"        nothing is wrong, it needs a little time   -> a pop-up that says nothing is lost, Try again
//   "unexpected"  something failed on our side               -> a pop-up that apologises, Try again, e-mail us
//
// Adding a message: add an entry below (m = a fragment of the message, numbers inside are ignored),
// or add the message to API_ONLY if no person ever sees it (AI links, our own tools). Then run
// `bun test src/lib/guide` - it fails when a message the database or a function can send has no guide.

export type GuideKind = "field" | "blocked" | "wait" | "unexpected"

/** Where "Take me there" goes. field/section are the visible words of a label or heading; "|" separates alternatives. */
export interface GuideGo {
  field?: string
  section?: string
  label?: string
  retry?: boolean
  mail?: boolean
  signIn?: boolean
  none?: boolean
}

export interface GuideEntry {
  m: string[]
  k: GuideKind
  t: string
  w: string
  d: string[]
  g: GuideGo
  /** Only for these HTTP statuses (omitted = any). */
  s?: number[]
}

const signIn: GuideGo = { signIn: true, label: "Sign in again" }
const retry: GuideGo = { retry: true }
const none: GuideGo = { none: true }
const mail: GuideGo = { mail: true }

export const CATALOG: GuideEntry[] = [
  // ---------- signing in, e-mail, links ----------
  { m: ["Unable to validate email address", "Email address is invalid", "That does not look like an email address", "These do not look like email addresses", "That does not look like an e-mail address", "Enter a full email address", "Enter the full e-mail address", "Email address \"", "That e-mail address looks wrong", "The billing contact e-mail looks wrong", "Enter a valid email"], k: "field", t: "Please check the e-mail address",
    w: "An e-mail address is missing something, so we cannot use it yet.", d: ["Type the full address: the part before the @ sign, the @ sign, and the part after it.", "Check there is an @ sign and no spaces.", "Then press the button again."], g: { field: "Your email|Owner’s email|Their email address|Who should get payment notes|Email", label: "the e-mail box" } },
  { m: ["An email address is required", "A recipient address is required"], k: "field", t: "Please type an e-mail address",
    w: "This step needs an e-mail address, and the box is empty.", d: ["Type the full address: the part before the @ sign, the @ sign, and the part after it.", "Then press the button again."], g: { field: "Their email address|Your email", label: "the e-mail box" } },
  { m: ["That passcode did not work", "That code did not work", "Type the passcode from the email", "Token has expired or is invalid", "The code was accepted but is not recent enough"], k: "field", t: "That code did not work",
    w: "The code was typed differently from the one we e-mailed, or it is more than a few minutes old.", d: ["Open the newest e-mail from us and type its digits again.", "If it is old, press Send me a new link and use only the newest e-mail."], g: { field: "Passcode|Code from your e-mail", label: "the code box" } },
  { m: ["email rate limit exceeded", "For security purposes, you can only request this", "Too many requests", "over_email_send_rate_limit", "rate limit exceeded"], k: "wait", t: "Please give it a little time",
    w: "Several e-mails were asked for in a short time, so we paused new ones to keep your account safe. Nothing is lost.", d: ["Open the newest e-mail we sent you and use that link.", "If nothing has arrived, look in the spam folder.", "Otherwise try again in a few minutes."], g: retry },
  { m: ["Signups not allowed", "Email link is invalid or has expired", "otp_expired", "Error sending magic link email", "Error sending confirmation email", "Error sending"], k: "unexpected", t: "We could not send your sign-in e-mail",
    w: "This is not your doing. The e-mail could not be sent just now, and nothing you typed is lost.", d: ["Wait a minute and press Try again.", "If it happens again, e-mail us and we will help."], g: { retry: true, mail: true } },
  { m: ["Sign in first", "Not signed in", "Sign in again, then upload", "JWT expired", "Auth session missing", "invalid JWT", "not authenticated"], k: "blocked", t: "Please sign in to continue",
    w: "We need to know it is you before we go on. Your work on this screen is kept.", d: ["Press Sign in again and ask for a new link.", "Open the newest e-mail we send you."], g: signIn },
  { m: ["You are not a member of any organisation here", "You are not a member of that organisation", "^Not a member of this organisation", "^Not a member of that firm", "No active membership", "Membership is not active"], k: "blocked", t: "This e-mail address is not part of that organisation",
    w: "The address you signed in with has not been added to this organisation, or it was removed.", d: ["Sign in with the e-mail address the invitation was sent to.", "If you are not sure which one it was, ask the owner of the organisation to name your address on a job and send the link again."], g: signIn },
  { m: ["That invite link is not valid", "An invite link is required", "Could not generate an invite link"], k: "blocked", t: "This invitation link does not work",
    w: "The link may have been cut short when it was copied, or it is old and was replaced by a newer one.", d: ["Ask the person who invited you to send the link again.", "Open the new link on this device."], g: none },
  { m: ["This link has expired or was revoked", "Link not found", "Not your link", "This draft link is not valid", "This undo link is not valid"], k: "blocked", t: "This link has been used up or has expired",
    w: "For your safety each link works for a limited time, or was switched off by the person who made it.", d: ["Ask for a fresh link from the place you first got it.", "If it was an AI link, the owner can make a new one from the AI work link section."], g: none },
  // ---------- jobs ----------
  { m: ["Job not found", "That job does not exist, or is not one this link can see"], k: "blocked", t: "That job is no longer on your list",
    w: "The job may have been finished, moved or removed while you were looking at it.", d: ["Press Try again to see the latest list.", "If you still need it, ask the owner of your organisation."], g: retry },
  { m: ["Not your job", "Only the owner or the person it is assigned to can mark it not applicable"], k: "blocked", t: "That job belongs to someone else",
    w: "Only the person a job is given to, or the owner of the organisation, can change it.", d: ["Ask the owner to give you the job, or to change it for you."], g: none },
  { m: ["Waiting — the step before this one isn't done yet", "Waiting - the step before this one"], k: "blocked", t: "This job is waiting for an earlier step",
    w: "The law asks for the steps to be done in order, so this one opens as soon as the one before it is finished.", d: ["Look at the job just above this one.", "When it is done, this one opens by itself."], g: none },
  { m: ["Only the owner can do this", "Only the owner can give a job to someone", "Only the owner can change when a job is due", "Only the owner can mark a job as not applicable", "Owner only", "Only the owner can see billing", "Only the owner can declare a payment", "Only the owner can record a payment", "Only the owner can pay for the organisation", "Only the owner can answer a grievance", "Only the owner can download the organisation", "Only the owner can give the firm", "Only the owner can choose the plan", "Only the owner can fill in the account details", "Only the owner can record a test payment", "Only the owner, a CA partner or a CA manager can share", "Only the organisation's owner or a head of department", "Only an owner of this organisation"], k: "blocked", t: "Only the owner can do this",
    w: "To keep the organisation’s records safe, this step is limited to the owner.", d: ["Please ask the owner of your organisation to do it.", "If you are the owner, sign in with the e-mail address the organisation was opened with."], g: none },
  { m: ["Marking something not applicable needs a written reason", "A reason can be", "Say in a few words why it doesn't apply"], k: "field", t: "Please say why this does not apply",
    w: "A job can be marked as not applying only with a short reason, so the record is complete.", d: ["Write a short reason in the box, up to 1,000 characters.", "Then press the button again."], g: { field: "Why doesn’t this apply|Why doesn't this apply", label: "the reason box" } },
  { m: ["^Already closed", "^Doesn't apply", "That job is already", "That job is marked not applicable", "That job is already marked not applicable"], k: "blocked", t: "That job is already settled",
    w: "This job was finished or marked as not applying, so it cannot be changed this way.", d: ["Nothing more to do for this job.", "If it was settled by mistake, ask the owner to look at its history."], g: none },
  { m: ["That is not an answer this job can record", "This job isn't assigned to a group", "You aren't a member of the group this job is assigned to"], k: "blocked", t: "That answer cannot be recorded here",
    w: "This job is answered by a group or by a different person.", d: ["Press Try again to see the job as it is now.", "If you think you should be in the group, ask the owner."], g: retry },
  { m: ["A note needs some words", "A note can be 1000 characters at most", "Write a few words first"], k: "field", t: "Please check your note",
    w: "A note is empty, or it is longer than 1,000 characters.", d: ["Write a few words, up to 1,000 characters.", "Then press the button again."], g: { field: "Your note", label: "the note box" } },
  { m: ["A date is required", "Pick a date from", "Pick a date", "A link sent by email can only move a due date"], k: "field", t: "Please choose a date that is allowed",
    w: "A due date can move to a day between 30 days ago and 400 days ahead.", d: ["Choose the new date in the date box.", "Then press the button again."], g: { field: "New due date", label: "the date box" } },
  { m: ["This job is required by today's law", "needs the person's own confirmation"], k: "blocked", t: "You need to confirm this one yourself",
    w: "Because this job is required by law, marking it as not applying must be confirmed by a person, not by a link.", d: ["Open the app and sign in.", "Open the job and choose Doesn't apply, with your reason."], g: signIn },
  // ---------- drafts and AI links (what a person sees on the confirm / undo screens) ----------
  { m: ["This draft was made from someone else's AI link", "This draft has already been confirmed", "This draft has expired", "A draft cannot be confirmed here yet"], k: "blocked", t: "This draft cannot be confirmed now",
    w: "A draft can be confirmed once, by the person whose AI link made it, and only for a limited time. Nothing has been changed.", d: ["Ask the AI assistant for a fresh draft.", "Then open the new link and confirm it."], g: none },
  { m: ["This change was already undone", "This has already been undone"], k: "blocked", t: "That change was already undone",
    w: "It was undone earlier, so the job is back as it was before the AI assistant touched it.", d: ["Nothing more is needed from you.", "You can see what happened in the job’s History."], g: none },
  { m: ["Only the person whose AI assistant made this change", "This change can no longer be undone"], k: "blocked", t: "This change cannot be undone now",
    w: "A change can be undone once, within 24 hours, by the owner or the person whose AI assistant made it.", d: ["If it is within 24 hours, sign in as the owner and open the link again.", "Otherwise the change stays; you can edit the job by hand."], g: none },
  { m: ["Your browser did not allow the automatic copy", "Could not copy"], k: "blocked", t: "Your browser would not copy it for you",
    w: "Some browsers stop a page from copying on its own. The link is still safe on this screen.", d: ["Press and hold the link, or select it with the mouse.", "Choose Copy from the menu."], g: { section: "Your AI work link, ready to paste|AI work link", label: "the link" } },
  { m: ["Pick a key from the list"], k: "field", t: "Please check the link settings",
    w: "One of the choices for the AI link needs another look.", d: ["Choose how long the link lasts: 1, 7 or 30 days.", "Then press the button again."], g: { field: "Link lasts", label: "how long the link lasts" } },
  // ---------- opening an organisation, plans, firms ----------
  { m: ["An organisation name is required", "The organisation name is too long"], k: "field", t: "Please give the organisation’s name",
    w: "We need a name for the organisation, up to 120 characters.", d: ["Type the name in the box.", "Then press the button again."], g: { field: "Organisation name|Client name", label: "the name box" } },
  { m: ["That is enough new organisations for one day"], k: "wait", t: "That is enough new organisations for one day",
    w: "To keep the service safe, only a few organisations can be opened from one account in a day. Nothing is lost.", d: ["Please try again tomorrow.", "If you need more today, e-mail us."], g: { mail: true } },
  { m: ["Please tick the box to continue", "Tick the box to confirm"], k: "field", t: "One box needs ticking first",
    w: "We need your agreement to the terms before we can go on, as the law asks.", d: ["Tick the box next to the line that explains it.", "Then press the button again."], g: { field: "This job really doesn't apply|I have read and agree|I agree|I accept", label: "the tick box" } },
  { m: ["Choose whether this is a CA, CS or ICMAI firm, or a company or institution", "product must be 'firm' or 'institution'", "plan must be 'firm' or 'institution'", "This organisation has no edition set yet", "has not chosen an edition"], k: "field", t: "This organisation is not set up yet",
    w: "This organisation has no type set, so we could not open it. Nothing is lost.", d: ["Press the button again.", "If it happens again, e-mail us."], g: { mail: true } },
  { m: ["Professional body must be ICAI, ICSI, ICMAI or other", "Give both the professional body and the membership"], k: "field", t: "Please check the professional body",
    w: "Give both the professional body and the membership or firm registration number, or leave both for now.", d: ["Choose the body from the list.", "Type the registration number next to it."], g: { field: "Professional body", label: "the professional body" } },
  { m: ["The registration number looks wrong"], k: "field", t: "Please check the registration number",
    w: "The number can have 3 to 40 letters, digits, slashes, dots or dashes.", d: ["Type the number exactly as on your certificate.", "Then press the button again."], g: { field: "Membership or firm registration number", label: "the registration number" } },
  { m: ["A professional body number is only for a firm", "Professional details are for a firm account", "This firm is already verified", "The free plan is for verified firms", "The free plan is for practising", "This firm has not given its professional details"], k: "blocked", t: "That is not available for this account",
    w: "The professional details and the free plan are for firms, and a verified firm’s details can be changed only by us.", d: ["If you are a firm, give your professional details and we will check them.", "If you need a detail changed, e-mail us."], g: { mail: true } },
  { m: ["That plan is not available for this kind of account", "No such plan", "There is nothing to pay on this plan", "No price is set for this plan", "Could not read the price"], k: "blocked", t: "That plan cannot be chosen here",
    w: "The plan chosen is not available for this kind of organisation, or it has nothing to pay.", d: ["Choose one of the plans shown on this screen.", "If none fits, e-mail us."], g: { section: "Plan|Billing", label: "the plans" } },
  { m: ["client organisations, and this plan covers", "Your plan covers up to", "Your plan is for your own firm's file"], k: "blocked", t: "Your plan covers fewer client organisations",
    w: "The plan you are on allows a set number of client organisations, and that number has been reached.", d: ["Open Plan and choose a bigger one.", "Then add the client again."], g: { section: "Plan|Billing", label: "Plan" } },
  { m: ["Choose which firm this client belongs to", "No such firm account", "No such account", "No such commission", "No such person", "This organisation has no account", "This organisation has no account to change", "No such organisation", "No such sales partner", "No such partner"], k: "blocked", t: "We could not find that account",
    w: "The account may have been closed, or the list changed while you were looking at it.", d: ["Press Try again to see the latest list.", "If it is still missing, e-mail us."], g: { retry: true, mail: true } },
  { m: ["This organisation is covered by its firm", "This account is on the free plan; nothing is due", "A test payment can only be recorded on a test account"], k: "blocked", t: "Nothing to pay here",
    w: "This organisation is covered by its firm or by a free plan, so there is nothing for it to pay.", d: ["No action is needed."], g: none },
  { m: ["Tick the declaration on your account page"], k: "field", t: "Please tick the declaration first",
    w: "The free plan is for practising CA, CS and cost accountants, and we ask you to confirm that.", d: ["Open your account page.", "Tick the declaration, then choose the free plan."], g: { field: "declaration|practising", label: "the declaration" } },
  // ---------- payment ----------
  { m: ["Payment is due for this account, so this screen is paused", "payment for this account is due"], k: "blocked", t: "This screen is paused until payment is made",
    w: "Payment for this account is due. Your data is safe, and you can still pay, download your data, record a breach or answer a grievance.", d: ["Open the Payment due screen.", "Pay, or download your data."], g: { section: "Payment due|Payment", label: "Payment due" } },
  { m: ["Online payment is for the yearly plan"], k: "blocked", t: "Online payment is for the yearly plan",
    w: "Payment on this screen is offered for the yearly plan. The monthly plan is paid by bank transfer.", d: ["Choose the yearly plan to pay online.", "Or pay by bank transfer and tell us the reference."], g: { section: "Plan|Billing", label: "Plan" } },
  { m: ["Too many payment attempts"], k: "wait", t: "Please try the payment a little later",
    w: "Several payment attempts were made in the last hour, so we paused new ones to keep your money safe. Nothing was charged twice.", d: ["Wait a little while, then try again.", "Or pay by bank transfer and tell us the reference."], g: retry },
  { m: ["No open payment attempt with that id", "A payment id is required", "No such payment", "This organisation has no payment awaiting confirmation"], k: "blocked", t: "We could not find that payment",
    w: "The payment may already be confirmed, or the list changed while you were looking at it.", d: ["Press Try again to see the latest payments.", "If money left your account and nothing shows, e-mail us the payment reference."], g: { retry: true, mail: true } },
  { m: ["Razorpay did not accept the request", "Could not start the payment", "We could not reach the payment service", "Temporary problem, please retry"], k: "wait", t: "We could not reach the payment service",
    w: "The payment did not start, so nothing was charged. Your connection may have dropped for a moment.", d: ["Check your internet connection.", "Press Try again, or pay by bank transfer and tell us the reference."], g: retry },
  { m: ["We could not match this payment", "The payment could not be verified", "The payment details did not match the order", "The payment is", "We are still waiting for Razorpay", "Payment not recorded"], k: "unexpected", t: "We could not confirm this payment yet",
    w: "If any money left your account, it is safe and will be confirmed or returned by your bank. Nothing is charged to your organisation until we confirm it.", d: ["Wait about five minutes and look again.", "If money was taken and nothing changes, e-mail us with the payment ID shown."], g: { retry: true, mail: true } },
  { m: ["Test payments are only available while the platform is in Test mode", "Type PURGE TEST DATA", "mode must be", "action must be list, add or remove", "Keep at least one address on the list", "The end date is before the offer starts", "extra percent off", "A code is 4 to 16 letters or digits"], k: "field", t: "Please check that setting",
    w: "A setting on this screen is missing or outside what is allowed.", d: ["Look at the highlighted box.", "Correct it and press the button again."], g: { field: "Organisation id|Reference|Paid for", label: "the setting" } },
  // ---------- sales partner and payouts ----------
  { m: ["You are not a Sales Partner yet", "Your personal link appears when your partner set-up", "Your partnership has ended"], k: "blocked", t: "This is for active Sales Partners",
    w: "You are not an active Sales Partner yet, or the partnership has ended.", d: ["Open Become a Sales Partner and finish the steps.", "If the partnership ended and you want to join again, e-mail us."], g: { mail: true } },
  { m: ["Accept the partner terms first", "These are not the current partner terms"], k: "blocked", t: "Please read and accept the partner terms first",
    w: "The payout details can be added only after the current partner terms are accepted.", d: ["Reload this page.", "Read the terms and tick the box, then add your payout details."], g: { field: "terms|I agree|I accept", label: "the terms" } },
  { m: ["Choose how you want to be paid"], k: "field", t: "Please choose how you want to be paid",
    w: "We pay by UPI or by bank transfer, so we need to know which you prefer.", d: ["Choose UPI or bank transfer.", "Then fill in the details that appear."], g: { field: "UPI id|Name on the bank account", label: "how you want to be paid" } },
  { m: ["The name must use letters only", "The name is too long"], k: "field", t: "Please check the name",
    w: "A name can use letters only, 2 to 80 of them.", d: ["Type the name using letters and spaces.", "Then press the button again."], g: { field: "Your name|Name on the bank account|Your name (optional", label: "the name box" } },
  { m: ["That PAN does not look right"], k: "field", t: "Please check the PAN",
    w: "A PAN has 5 letters, 4 digits and 1 letter, like ABCDE1234F. It is optional.", d: ["Type the PAN again, or leave the box empty."], g: { field: "PAN", label: "the PAN box" } },
  { m: ["That UPI id does not look right"], k: "field", t: "Please check the UPI id",
    w: "A UPI id looks like name@bank.", d: ["Type the UPI id exactly as shown in your UPI app.", "Then press the button again."], g: { field: "UPI id", label: "the UPI box" } },
  { m: ["Enter the name on the bank account"], k: "field", t: "Please give the name on the bank account",
    w: "We need the name exactly as the bank has it, so the payment reaches you.", d: ["Type the name as on your passbook or cheque.", "Then press the button again."], g: { field: "Name on the bank account", label: "the bank name box" } },
  { m: ["The account number must be 9 to 18 digits"], k: "field", t: "Please check the account number",
    w: "A bank account number has 9 to 18 digits.", d: ["Type the digits only, with no spaces.", "Then press the button again."], g: { field: "Account number", label: "the account number box" } },
  { m: ["That IFSC code does not look right"], k: "field", t: "Please check the IFSC code",
    w: "An IFSC code has 11 characters, for example HDFC0001234.", d: ["Type the IFSC code from your passbook or cheque.", "Then press the button again."], g: { field: "IFSC code", label: "the IFSC box" } },
  { m: ["Choose a month like", "That month has not finished yet"], k: "field", t: "Please choose a finished month",
    w: "A statement or a payout is for a month that has already ended.", d: ["Choose last month or an earlier one.", "Then press the button again."], g: { field: "Statement for|Pay for month", label: "the month" } },
  { m: ["Days before a commission is payable", "The payout day must be", "The minimum payout cannot be negative", "TDS percentage must be", "The status must be active, paused or ended", "Set the TDS percentage first", "Enter the UTR or transaction reference"], k: "field", t: "Please check that figure",
    w: "A figure on the partner screen is outside what is allowed, or still empty.", d: ["Look at the box that was just changed.", "Type a figure in the allowed range, then press the button again."], g: { field: "TDS % (0 if none)|Minimum payout (Rs)|Pay for month", label: "the figure" } },
  { m: ["This partner has not finished set-up", "This partner cannot be paid yet", "Nothing is payable to this partner for that month", "The net amount is below the minimum payout"], k: "blocked", t: "This partner cannot be paid for that month",
    w: "Either the partner has not finished set-up, or the amount for the month is below the minimum and carries forward.", d: ["Nothing is lost: the amount is kept for the next month.", "Check the partner’s set-up on this screen."], g: none },
  { m: ["Could not generate a referral code", "Could not make a code"], k: "wait", t: "We could not make your link just now",
    w: "Nothing is lost. The code could not be made on this try, and nothing was charged.", d: ["Press Try again."], g: retry },
  // ---------- rights, grievances, breach ----------
  { m: ["Describe what happened in a few sentences", "Write the answer in a few sentences"], k: "field", t: "Please write a few sentences",
    w: "This record needs a short description in your own words, up to 4,000 characters.", d: ["Write what happened, or your answer, in the box.", "Then press the button again."], g: { field: "Your answer|Record a personal data breach|Answer a grievance", label: "the box" } },
  { m: ["No open grievance with that id"], k: "blocked", t: "That grievance is already answered",
    w: "It may have been answered a moment ago, or the list changed.", d: ["Press Try again to see the latest list."], g: retry },
  { m: ["We could not load your data", "That did not work"], k: "wait", t: "We could not load that just now",
    w: "Nothing is lost. The page could not be loaded on this try.", d: ["Check your internet connection.", "Press Try again."], g: retry },
  { m: ["Please give the name of the person you nominate", "Please shorten the relationship"], k: "field", t: "Please check the nominee’s details",
    w: "A nominee needs a name. The e-mail address and relationship are optional.", d: ["Type the nominee’s name.", "Then press Save."], g: { field: "Nominee name", label: "the nominee’s name" } },
  { m: ["Please answer Yes or No for each item"], k: "field", t: "Please answer every question",
    w: "Each item needs a Yes or a No before your answer can be saved.", d: ["Look for the item with no answer chosen.", "Choose Yes or No, then press the button again."], g: { field: "Yes|No", label: "the first unanswered item" } },
  { m: ["Please give the name of the parent or legal guardian", "Please say whether you are the parent or the legal guardian"], k: "field", t: "Please tell us who is answering",
    w: "For a child’s data we need the name of the parent or legal guardian, and which of the two they are.", d: ["Type your name in Your name.", "Choose whether you are the parent or the legal guardian."], g: { field: "Your name|You are the", label: "your details" } },
  // ---------- audit log ----------
  { m: ["We could not send a code"], k: "wait", t: "We could not send the code just now",
    w: "Nothing is lost. The code e-mail could not be sent on this try.", d: ["Wait a minute.", "Press Send me a code again."], g: retry },
  { m: ["Confirm a new code first", "Confirm a fresh code first"], k: "blocked", t: "Please confirm a fresh code first",
    w: "To protect your audit log, a download needs a code confirmed in the last few minutes.", d: ["Press Send me a code and open the e-mail.", "Type the code in Code from your e-mail, then download."], g: { field: "Code from your e-mail", label: "the code box" } },
  { m: ["You can download up to", "files an hour"], k: "wait", t: "That is enough downloads for this hour",
    w: "To keep the log safe, only a few downloads are allowed in an hour. Nothing is lost.", d: ["Try again a little later."], g: none },
  { m: ["The download could not be recorded"], k: "wait", t: "The download could not start",
    w: "Every download is written to the log first, and that did not work on this try. No file was given out.", d: ["Wait a minute.", "Press Try again."], g: retry },
  { m: ["Only the platform owner may", "Only the platform operator", "A legal hold needs a reason", "A reason of at least 10 characters", "Start the offboarding first"], k: "blocked", t: "That step is kept for the platform team",
    w: "This step can be taken only by the VERIDIAN platform team.", d: ["If you need it done, e-mail us and tell us which organisation."], g: mail },
  // ---------- uploads ----------
  { m: ["That file is over 5 MB"], k: "field", t: "That file is too large",
    w: "A screenshot or PDF can be up to 5 MB.", d: ["Choose a smaller file, or take a smaller screenshot.", "Then upload it again."], g: { field: "screenshot|Upload|file", label: "the file box" } },
  { m: ["Please upload a PNG, JPEG, WebP or PDF file"], k: "field", t: "Please choose a different kind of file",
    w: "We can take a picture (PNG, JPEG or WebP) or a PDF.", d: ["Choose a picture or PDF file.", "Then upload it again."], g: { field: "screenshot|Upload|file", label: "the file box" } },
  // ---------- one-time links (act, parent, consent pages) ----------
  { m: ["This link is not valid", "This link has expired", "This link no longer works", "This link does not match that answer", "That is not an answer this link can record", "That is not one of the items on this link"], k: "blocked", t: "This link cannot be used",
    w: "The link may be old, mistyped, switched off or for a different answer. Nothing has changed.", d: ["Open the newest e-mail we sent you and use the link in it.", "If you cannot find it, ask the person who sent you this one for a fresh link."], g: none },
  { m: ["This link has already been used", "This job is already marked done"], k: "blocked", t: "That has already been done",
    w: "Each link works once, and this one has been used. Nothing has changed.", d: ["No more is needed from you.", "If you think this is a mistake, ask the owner of the organisation to look at the job’s history."], g: none },
  { m: ["There is nothing to withdraw", "That answer is only for group jobs"], k: "blocked", t: "There is nothing to change here",
    w: "This answer was not given, or this kind of answer does not apply to this item.", d: ["Look at the items on this page.", "Choose one that you answered earlier."], g: none },
  { m: ["Choose what you are asking for", "Please say what is wrong and what it should be"], k: "field", t: "Please tell us what you would like",
    w: "We need to know whether you want to see your data, correct it or delete it, and for a correction, what should change.", d: ["Choose one of the options.", "If you are correcting something, write what should change."], g: { field: "Ask us|Details|What", label: "your request" } },
  { m: ["You already have several open requests"], k: "wait", t: "We are still answering your earlier requests",
    w: "You already have several open requests, so we will answer those first. Nothing is lost.", d: ["Please wait for our answers.", "You can see them under Your requests."], g: { section: "Your requests", label: "Your requests" } },
  { m: ["A platform administrator cannot be erased"], k: "blocked", t: "That account cannot be erased from here",
    w: "This account has extra duties on the platform, so we handle its erasure ourselves.", d: ["E-mail us and we will arrange it."], g: mail },
  { m: ["nothing is due, or the organisation is on legal hold"], k: "blocked", t: "There is nothing to pay or to remove right now",
    w: "Either nothing is due on this account, or the records are on a legal hold and cannot be changed.", d: ["No action is needed.", "If you expected something to be due, e-mail us."], g: mail },
  { m: ["Enter numbers only"], k: "field", t: "Please type numbers only",
    w: "That box takes a figure, such as 10 or 2.5.", d: ["Remove any letters or symbols.", "Then press the button again."], g: { field: "TDS % (0 if none)|Minimum payout (Rs)", label: "the figure" } },
  { m: ["Could not complete the request", "Your answer could not be saved"], k: "wait", t: "That did not go through",
    w: "Something stopped it just now. Nothing you did is lost.", d: ["Please wait a moment.", "Then press the button again."], g: retry },
  // ---------- network, timing, our side ----------
  { m: ["Failed to fetch", "NetworkError", "Load failed", "Network request failed", "network error", "No connection", "fetch failed"], k: "wait", t: "We could not reach the service",
    w: "Your internet connection may have dropped for a moment. Nothing you typed is lost on this screen.", d: ["Check your internet connection.", "Then press Try again."], g: retry },
  { m: ["statement timeout", "canceling statement", "timed out", "Gateway Time-out", "Service Unavailable", "PGRST002", "schema cache", "temporarily unavailable", "is busy right now"], k: "wait", t: "It is very busy right now",
    w: "Many people are using the service at this moment. Nothing you did is lost.", d: ["Please wait a minute or two.", "Then press Try again."], g: retry },
  { m: ["Something failed on our side", "Something went wrong", "Could not complete", "permission denied", "violates check constraint", "violates foreign key", "violates not-null", "row-level security", "duplicate key value", "Could not find the function", "Internal Server", "Request failed", "This service is not configured", "The payout encryption key", "are not set", "http", "no rows", "not undoable"], k: "unexpected", t: "Something did not work on our side",
    w: "This is not your doing. Your work on this screen is kept.", d: ["Please wait a minute and press Try again.", "If it happens again, e-mail us with the reference shown."], g: { retry: true, mail: true } },
]

/**
 * Messages that are never put in front of a person: AI links and drafts speaking to an AI assistant,
 * our own tools and checks, the payment service calling us, and record-keeping safeguards that a
 * person cannot reach through the screens. Matching is by the start of the message, ignoring case
 * and numbers. If one of these ever did reach a screen, the general "Something did not work on our
 * side" guide is shown, so no one is left with a bare message.
 */
export const API_ONLY: string[] = [
  // append-only safeguards, set-up checks, internal rules
  "dpdp.", "% is append-only", "The platform audit trail is append-only", "can_sign cannot", "Create the Vault secret", "No dpdp.library_version", "assignments must be a list",
  "*is not something an AI link may draft", "*cannot be given to one person from an AI link", "*is not an action. Level", "*The link can last", "*is not a member of this organisation. An AI link", "Unknown RPC", "interval must be", "amount_paise must be", "unknown job", "Unknown email kind", "record_email_send accepts", "Unknown email status", "email_send", "Job % does not belong", "Unknown verb", "Unknown mail class", "Invalid mail ref", "Mail ref", "p_due_days",
  "Unknown reminder key", "status must be sent", "An event id is required", "Unknown acceptance kind", "A recorded acceptance cannot be changed", "decision must be", "A Razorpay payment id is required",
  "status must be authorized", "A refund id", "status must be pending", "a commission id", "status must be", "month must be", "sid is required", "unknown status", "no such suggestion", "Unknown register",
  // AI-link language (spoken to an AI assistant, not to a person)
  "payload", "obligationId is required", "ASSIGN needs", "SET_DUE needs", "NOTE needs", "NOTE text is too long", "MARK_NA reason", "DRAFT payload", "level must be 0", "filters must be", "part must be",
  "status must be one of", "A law code looks like", "report must be one of", "has legal weight", "is not an action", "This link is read-only", "value must be", "value is too long", "job_id is required",
  "% needs value", "is not something an AI link may draft", "An e-mailed link can last", "This part of the organisation is for the owner", "No such suggestion", "kind must be one of",
  "title must be", "body must be", "A suggestion is about the product", "Daily limit reached", "Level", "Nothing to confirm",
  // functions called by machines
  "Body too large", "Body must be", "Request body is too large", "Request too large", "Invalid JSON", "Invalid signature", "Unreadable event", "Invalid event", "Send a JSON body", "Unauthorized", "unauthorised", "unauthorized",
  "Not allowed", "No such route", "No such path", "No such register", "Use ", "_method", "?_method", "No token in the address", "Over the rate limit", "A browser may only report", "Too large", "This is internal",
  "org_id is required", "POST only", "paymentId is required", "Unknown job", "unknown job", "bad now", "missing amount", "central ledger", "Give ?", "hours must be", "limit must be", "SUPABASE_URL", "DPDP_", "RESEND_",
  "not configured", "payload too large", "unreadable body", "empty or malformed", "the message is recorded", "dry run", "could not record", "raw forward", "could not read", "send failed", "sent but not marked",
  "amount_mismatch", "attempt_already_paid", "currency_mismatch", "unknown_order", "=rate", "=sid", "Resend ", "could not fetch", "the event carries", "could not process", "org ", "Body too", "Give the", "Not found", "Bad ", "Webhook", "The payment service said", "Create the", "Online payment is for the yearly plan:",
]

/** What to show for a message nothing above matches, by HTTP-style status. The unexpected guide is the last resort. */
export const BY_STATUS: Record<number, Omit<GuideEntry, "m" | "s">> = {
  0: { k: "wait", t: "We could not reach the service", w: "Your internet connection may have dropped for a moment. Nothing you typed is lost on this screen.", d: ["Check your internet connection.", "Then press Try again."], g: retry },
  400: { k: "field", t: "One detail needs a look", w: "Something you entered is missing or is not in the form we expect.", d: ["Look at the boxes on this screen for one that is empty or has a slip.", "Correct it and press the button again."], g: none },
  401: { k: "blocked", t: "Please sign in to continue", w: "We need to know it is you before we go on. Your work on this screen is kept.", d: ["Press Sign in again and ask for a new link."], g: signIn },
  403: { k: "blocked", t: "This is not available from here", w: "Your sign-in does not allow this step.", d: ["Sign in with the e-mail address the organisation knows you by.", "If you think you should be allowed, ask the owner of your organisation."], g: signIn },
  404: { k: "blocked", t: "We could not find that", w: "The link may be old or mistyped, or the item was removed.", d: ["Open the link from your latest e-mail.", "Or ask the person who sent it for a new link."], g: none },
  429: { k: "wait", t: "Please give it a moment", w: "There were many tries in a short time, so we paused for your safety. Nothing is lost.", d: ["Wait a few minutes.", "Then press Try again."], g: retry },
  500: { k: "unexpected", t: "Something did not work on our side", w: "This is not your doing. Your work on this screen is kept.", d: ["Please wait a minute and press Try again.", "If it happens again, e-mail us with the reference shown."], g: { retry: true, mail: true } },
}
BY_STATUS[502] = BY_STATUS[503] = BY_STATUS[504] = BY_STATUS[500]
