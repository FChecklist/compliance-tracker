// The words of the job playbook: one entry per library job (library 0.2-wo010: 31 firm + 28 institution), keyed by the library's own key.
// Written 2026-09-30 by AI authors, then reviewed twice, independently, before this file was made -- once for legal safety and honesty
// (nothing invented: no section or rule number, no penalty, no promise VERIDIAN cannot keep), once for usability by a weak AI and a busy
// non-lawyer -- and then fixed against both. THIS FILE IS NOW THE SOURCE OF TRUTH: edit it directly. src/lib/services/dpdp-ai-link-playbook.test.ts
// pins the shape, the length, the honesty rules and the coverage of all 59 jobs; the owner's checklist test builds the page from it.
//
// The library will be replaced by a lawyer-reviewed version (WO-DPDP-010). Add that library's keys here, or leave them out: a job with no entry
// gets a general playbook for its part of the list (playbook.ts), never an empty page.
//
// The words are practical guidance, described as a way to do the job and never as the only lawful way. The law behind each job is fetched with
// GET /law/{code} (law.ts, with its `verify` notes), not written here.

import type { JobPlaybook } from "./playbook.ts"

export const PLAYBOOK_DATA: Record<string, JobPlaybook> = {
  // firm-01 -- Name the Grievance Officer (responsible for DPDP policy)
  "firm-01": {
    "why": "Customers and staff need one named person for data complaints, and the privacy rules ask for this. Without one, complaints get lost.",
    "who": "A senior owner, partner or manager; HR and IT help with staff and system questions.",
    "steps": [
      "Pick a senior, reachable person who will stay and can decide things.",
      "Ask them to accept, agree the reply time, and name a backup for leave.",
      "Choose a business email, ideally a shared mailbox, and an office phone number to show publicly.",
      "Agree a fixed time to acknowledge and answer complaints, within the grievance rule's outer limit. Check that limit with your lawyer or adviser."
    ],
    "ask": [
      "Who will be the Grievance Officer, and what is their role?",
      "Which business email and office phone should be shown?",
      "Who covers when they are away?",
      "In how many days will complaints be answered?"
    ],
    "proof": "Officer has accepted and contact details are agreed. Keep a short appointment note in your own folder or drive.",
    "note": "Grievance Officer is {name}, {role}, {email}, {phone}. Backup {backup}. Replies within {reply_days} days. Recorded {date}.",
    "notApplicableWhen": null,
    "email": {
      "to": "The chosen officer",
      "subject": "Please be our Grievance Officer",
      "body": "Hello {their_name}, please be our Grievance Officer and take complaints about how {org} handles personal data. Reply by {due_date} to accept, with a business email and office phone we can publish. Thanks, {your_name}"
    },
    "watchFor": [
      "Use business contact details, never a personal mobile or personal email."
    ]
  },
  // firm-02 -- Name a DPDP coordinator
  "firm-02": {
    "why": "DPDP is India's data-protection law, and its work touches accounts, HR, IT and marketing, so someone must chase everyone or jobs sit undone. This is good practice, not a named legal post.",
    "who": "A well-organised manager, backed by the owner or partners; every team head helps.",
    "steps": [
      "Choose someone who can ask colleagues for information and follow up politely.",
      "Agree how much time they give each week, for example one hour.",
      "Tell the owner and team heads who it is, and that requests from this person must be answered.",
      "Ask them to review the job list weekly, report overdue jobs to the owner, and name a backup."
    ],
    "ask": [
      "Who will be the DPDP coordinator (name and role), and who is the backup?",
      "Who do they report to, and how often?",
      "How much time can they give each week?"
    ],
    "proof": "A named coordinator and backup, known to the owner and team heads. Keep a short note or email naming them in your own folder or drive.",
    "note": "DPDP coordinator is {name}, {role}, backup {backup}. Reports to {owner} {how_often}. Recorded {date}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Do not name someone with no time or authority.",
      "In a very small firm the Grievance Officer can also be the coordinator."
    ]
  },
  // firm-03 -- Publish the Grievance Officer’s name and contact — on your website or a free VERIDIAN page
  "firm-03": {
    "why": "People cannot complain if they cannot find who to contact, and the rules ask for this contact to be public.",
    "who": "The Grievance Officer (responsible for DPDP policy); whoever manages your website helps put it online.",
    "steps": [
      "Read the officer's name, role, email and phone from the Grievance Officer job's note; ask only if missing.",
      "Choose where: your own website (footer or contact page), or the free VERIDIAN page.",
      "For the VERIDIAN page, point the person to this job on their VERIDIAN page. You cannot publish it; invent no steps.",
      "Write it plainly: name, role, business email and phone.",
      "Publish it, or hand the wording to whoever updates your website.",
      "Open the page on a phone and check the details."
    ],
    "ask": [
      "Do you have a website, and who updates it?",
      "Which web address will it go on?",
      "Which office phone number should be shown next to the email?"
    ],
    "proof": "Page is live. Keep its web address and a dated screenshot in your own folder or drive.",
    "note": "Grievance Officer contact published at {url} on {date}. Screenshot kept.",
    "notApplicableWhen": null,
    "email": {
      "to": "Website firm or website updater",
      "subject": "Please add our Grievance Officer contact",
      "body": "Hello {their_name}, please add this to our website by {due_date}: Grievance Officer {officer_name}, {officer_role}, {officer_email}, {officer_phone}. Reply with the web address once live. Thanks, {your_name}, {org}"
    },
    "watchFor": [
      "Use plain text, not an image or PDF.",
      "Update the page when the officer changes."
    ]
  },
  // firm-04 -- Write down where it is kept, why you need it, and who can open it
  "firm-04": {
    "why": "You cannot protect customer data you have not mapped. This record shows what you keep, why, and who can see it, and helps you spot data you should not hold.",
    "who": "Whoever runs customer records, such as sales or accounts; IT helps with where files and systems sit.",
    "steps": [
      "List every place customer details sit: billing software, Excel, phone contacts, WhatsApp, email, paper files, drives.",
      "Next to each place, mark which items it holds, such as PAN or bank details.",
      "For each item, write in one line why you need it. Mark anything you cannot justify.",
      "List the roles that can open each place, not names, and note any shared logins.",
      "Save the list in your own folder or drive."
    ],
    "ask": [
      "Where is customer data kept, including WhatsApp, Excel and paper?",
      "Why do you keep each item: name, phone, email, address, PAN, bank details? Suggest likely reasons, such as billing, for them to confirm.",
      "Which roles can open each place?"
    ],
    "proof": "A one-page list of places, purpose and access roles. Keep it in your own folder or drive; update it when tools change.",
    "note": "Customer data kept in {places}. Needed for {purpose}. Opened by {roles}. Recorded {date}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Do not forget personal phones, WhatsApp groups and old Excel files.",
      "'Just in case' is a weak reason to keep something. Write a clear purpose or mark it for review."
    ]
  },
  // firm-05 -- Write down where it is kept, why you need it, and who can open it
  "firm-05": {
    "why": "Staff records hold your most sensitive data, like Aadhaar, salary and medical details. Knowing where it sits and who opens it helps stop leaks from inside the office.",
    "who": "HR or whoever keeps staff files, with the accounts or payroll person; IT helps with where files sit.",
    "steps": [
      "List every place staff details sit: HR files, payroll software, Excel, email, WhatsApp, attendance system, cloud drives.",
      "Against each place, mark which items it holds, especially Aadhaar, bank account and medical details.",
      "Write why you need each item, such as salary payment, PF or tax filing.",
      "List the roles that can open each place, and remove access that is not needed.",
      "Save the record in your own folder or drive."
    ],
    "ask": [
      "Where are staff records kept, including Excel, payroll software and paper files?",
      "Which roles can open medical and Aadhaar details?",
      "Does an outside payroll or software firm also hold staff data?"
    ],
    "proof": "A one-page record of places, purpose and access roles for staff data. Keep it in your own folder or drive and update it when tools change.",
    "note": "Staff data kept in {places}. Needed for {purpose}. Opened by {roles}. Outside holders: {firms}. Recorded {date}.",
    "notApplicableWhen": "You have no employees at all, not even part-time or contract staff whose details you keep.",
    "email": null,
    "watchFor": [
      "Aadhaar photocopies in open drawers or shared drives are a common weak spot."
    ]
  },
  // firm-06 -- Write down where it is kept, why you need it, and who can open it
  "firm-06": {
    "why": "CVs arrive by email, WhatsApp and job sites and pile up unnoticed. Knowing where they are lets you protect them and delete old ones.",
    "who": "HR or whoever hires, with the office manager; IT helps with mailboxes and shared drives.",
    "steps": [
      "Check where CVs land: HR mailbox, managers' inboxes, WhatsApp, job portals, recruiter emails, printouts.",
      "Write why you keep them: the current opening only, or a talent pool the applicant agreed to.",
      "List the roles that can open the CV folders, and remove access that is not needed.",
      "Ask how long unsuccessful CVs should be kept; if unsure, suggest a short period, but the person decides.",
      "Save the record in your own folder or drive."
    ],
    "ask": [
      "Where do CVs arrive and get stored, including WhatsApp and managers' inboxes?",
      "Do you keep CVs of people you did not hire, why, and for how long?",
      "Do recruitment agencies or job portals hold copies for you?"
    ],
    "proof": "A one-page record of where CVs sit, why, who can open them and how long unsuccessful ones stay. Keep it in your own folder or drive.",
    "note": "Applicant CVs kept in {places} for {purpose}. Opened by {roles}. Unsuccessful CVs kept {period}. Recorded {date}.",
    "notApplicableWhen": "You never receive CVs or job applications from anyone, including by email or WhatsApp.",
    "email": null,
    "watchFor": [
      "CVs forwarded to managers' personal email or WhatsApp are easy to forget."
    ]
  },
  // firm-07 -- Write down where it is kept, why you need it, and who can open it
  "firm-07": {
    "why": "Your website quietly collects names, numbers and cookies. Your website firm usually knows exactly what and where it goes, so ask them in writing.",
    "who": "The website firm holds the facts; someone inside records their answers.",
    "steps": [
      "Draft the email below for the person to send to the website firm; ask them to paste the reply here.",
      "From the reply, note what each form, chat box, analytics and ad tool collects, and why.",
      "Record where the data is stored, who receives it, and which roles have logins."
    ],
    "ask": [
      "Who maintains your website, and who is your contact?",
      "Does the site show ads, track visitors or have a chat box?",
      "Has the firm replied? If so, paste their answers here."
    ],
    "proof": "The firm's written reply and a one-page record of what is collected, why, where stored and who has logins. Keep both in your own folder or drive.",
    "note": "Website collects {data} via {tools}. Stored in {where}. Logins: {roles}. Firm {firm} replied {date}.",
    "notApplicableWhen": "You have no website, web form or app, and collect nothing from visitors online.",
    "email": {
      "to": "Website firm",
      "subject": "Questions about data collected on our website",
      "body": "Hello {their_name}, for our data-protection records, please tell me by {due_date} what data our site collects, where it is stored, who receives it, who has admin logins, and which cookies and outside tools it uses. Thanks, {your_name}, {org}"
    },
    "watchFor": [
      "Ask who has access, never for the passwords."
    ]
  },
  // firm-08 -- Write down where the recordings are kept and for how long
  "firm-08": {
    "why": "Recordings show identifiable people. Old footage that nobody tracks piles up and can leak.",
    "who": "The office or facilities manager, with the installer or security agency.",
    "steps": [
      "Draft the email below for the person to send to the installer; ask them to paste the reply here.",
      "From the reply, note where footage is stored, for how many days, and who can view or download it.",
      "Choose a fixed short period that fits your purpose; ask your adviser if any rule for your business needs longer.",
      "Ask the installer to set it. Do not shorten it while an incident or dispute needs older footage.",
      "Keep incident footage only while needed, including for any police or legal matter, then erase it."
    ],
    "ask": [
      "Where are recordings stored, and for how many days?",
      "Which roles can view or download them?"
    ],
    "proof": "Storage place, keep period and access roles are written down and match the camera settings, kept in your own folder or drive.",
    "note": "CCTV recordings kept on {place} for {days} days. Access: {roles}. Recorded {date}.",
    "notApplicableWhen": "You have no CCTV cameras at any of your premises.",
    "email": {
      "to": "Installer or security agency",
      "subject": "CCTV keep period and access",
      "body": "Hello {their_name}, please confirm by {due_date} where our recordings are stored, how many days they are kept, who can view or download them, and how the period can be changed. Thanks, {your_name}"
    },
    "watchFor": [
      "Cloud camera apps may keep footage longer than the office recorder."
    ]
  },
  // firm-09 -- Write down where fingerprints or face scans are stored and who can open them
  "firm-09": {
    "why": "A fingerprint or face scan cannot be changed if stolen, unlike a password. Know where scans sit and who can open them.",
    "who": "HR or the admin manager, with the machine vendor or IT person.",
    "steps": [
      "Use the email below to ask the vendor whether scans stay in the machine, a vendor cloud, or your payroll software.",
      "List the roles with administrator access, and remove shared logins.",
      "Check the factory admin password was changed; never ask for it.",
      "Make deleting a leaver's scans a step in your exit checklist."
    ],
    "ask": [
      "Where are scans stored: machine, vendor cloud or payroll software?",
      "Which roles are administrators?",
      "Who deletes a leaver's scans, and when?"
    ],
    "proof": "A written note of where scans sit, who administers them, and how leavers' scans are deleted. Keep it in your own folder or drive.",
    "note": "Attendance scans stored in {place}. Administrators: {roles}. Leavers' scans deleted by {who} {when}. Recorded {date}.",
    "notApplicableWhen": "You have no fingerprint or face-scan machine.",
    "email": {
      "to": "Attendance machine vendor",
      "subject": "Where our attendance scans are stored",
      "body": "Hello {their_name}, please tell me by {due_date} where our fingerprint and face data is stored, whether images or only a coded template are kept, whether it is encrypted, who can access it, and how a leaver's data is deleted. Thanks, {your_name}, {org}"
    },
    "watchFor": [
      "Scans copied to a vendor cloud count as stored there too.",
      "Taking scans also needs written consent, under a separate job."
    ]
  },
  // firm-10 -- Write down how long each is kept — keep only what tax and labour law require, delete the rest
  "firm-10": {
    "why": "Data kept too long can leak, so delete it once its purpose is over, unless a law makes you keep it. Data still in use stays.",
    "who": "Accounts, with team heads and your accountant or payroll adviser.",
    "steps": [
      "Read the earlier data notes to list each data set; ask only about gaps.",
      "Ask your chartered accountant how long tax, labour or other laws that apply make you keep each record. Do not guess; paste the reply here.",
      "Write a keep period beside each data set. If no law makes you keep it, keep it only while you use it.",
      "Set reminders to delete data past its period, yearly or more often, including outside firms' copies."
    ],
    "ask": [
      "Do you already have a retention policy?",
      "Which outside firms hold copies, such as payroll firms?",
      "Who will do the yearly deletion, and in which month?"
    ],
    "proof": "A table of each data set, keep period and reason, with dated deletion notes, in your own folder or drive.",
    "note": "Retention set: {dataset_and_period}. Yearly review by {who} in {month}. Recorded {date}.",
    "notApplicableWhen": null,
    "email": {
      "to": "Your accountant or payroll adviser",
      "subject": "How long must we keep records?",
      "body": "Hello {their_name}, please list by {due_date} which records {org} must keep under tax, labour or any other law that applies to us, and for how long. Thanks, {your_name}"
    },
    "watchFor": [
      "Delete nothing until the adviser replies; customers or staff may need advance warning.",
      "Backups and old email also need deleting."
    ]
  },
  // firm-11 -- Give a privacy notice when you collect their data — on the form, invoice or website
  "firm-11": {
    "why": "People should know what you collect, and why, when they give it, and the privacy rules ask for a notice at that point. A clear one also stops complaints that start from surprise.",
    "who": "Whoever owns customer data or marketing, with whoever designs your forms, invoices and website.",
    "steps": [
      "List every point where customers give data: forms, invoices, website, WhatsApp, shop counter, phone calls.",
      "Draft a short notice from the customer-data note: what you collect, why and who receives it.",
      "Add how to use their rights and how to complain to the Data Protection Board. Invent no contact details for it.",
      "Keep it separate and simple, in your customers' language.",
      "Put it, or a short link to it, on each form, invoice and web page.",
      "Save one dated example of each in your own folder or drive."
    ],
    "ask": [
      "Where do customers give you their details today?",
      "Who do you share customer details with, such as couriers or software firms?",
      "Which languages do your customers read?",
      "Is the Grievance Officer the contact for customers' questions?"
    ],
    "proof": "The notice text and a dated sample of each place it appears, kept in your own folder or drive.",
    "note": "Privacy notice placed on {places} from {date}. Contact for questions: {contact}. Languages: {languages}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Do not copy another firm's notice; edit it to match what you really do.",
      "Phone and counter sales need a spoken or printed notice too."
    ]
  },
  // firm-12 -- Take consent before sending marketing messages — and make stopping as easy as starting
  "firm-12": {
    "why": "Customers complain when unwanted offers reach their phone or inbox, and the DPDP Act asks for clear consent and an easy way to stop. Doing both also keeps your list clean.",
    "who": "Whoever runs marketing or customer messages, with your bulk SMS, WhatsApp or email provider.",
    "steps": [
      "List each way you send offers: SMS, WhatsApp, email, calls.",
      "Ask for consent with an empty tick box or a reply of YES. Never pre-tick.",
      "Say plainly what messages people will get and how often, and save when and how each person agreed.",
      "Add a one-step way to stop, such as replying STOP or an unsubscribe link, and act on it quickly.",
      "Stop offers to anyone who has not clearly agreed, but keep them as customers; ask again only when they next deal with you."
    ],
    "ask": [
      "Which channels do you use for offers?",
      "How do you collect and record agreement today?",
      "How can someone stop messages today?"
    ],
    "proof": "Consent wording, a record of when and how people agreed, and a working stop method. Keep samples in your own folder or drive.",
    "note": "Marketing via {channels}. Consent taken by {method}, recorded in {where}. Stop method: {stop}. Reviewed {date}.",
    "notApplicableWhen": "You never send offers, newsletters or campaigns to customers by phone, SMS, WhatsApp or email.",
    "email": null,
    "watchFor": [
      "Consent made a condition of buying something may not count as freely given.",
      "Stopping must be as easy as signing up."
    ]
  },
  // firm-13 -- Tell staff what you hold and why — no consent is needed for employment
  "firm-13": {
    "why": "Staff should know what you keep about them and why, and the DPDP Act asks for a notice. Ordinary employment use needs no consent, so this is a notice, not a consent form.",
    "who": "HR or whoever keeps staff files, with the owner's sign-off.",
    "steps": [
      "From the staff-data note, write a short notice: what you hold, why, who sees it and how long.",
      "Add how staff can use their rights, and how to complain to the Data Protection Board.",
      "Share it with all staff, contract and part-time included, and every new joiner.",
      "Ask staff to acknowledge they have read it; this is not consent."
    ],
    "ask": [
      "How will you share it: email, WhatsApp, handbook or noticeboard?",
      "Is the Grievance Officer also the contact for staff questions?",
      "How many staff have acknowledged?"
    ],
    "proof": "The notice, how and when it was shared, and who acknowledged it, kept in your own folder or drive.",
    "note": "Staff notice shared by {method} on {date}. Contact: {contact}. Acknowledged by {count} staff.",
    "notApplicableWhen": "You have no employees, not even part-time or contract staff.",
    "email": {
      "to": "All staff",
      "subject": "About your personal data",
      "body": "Dear team, {org} holds these details about you: {data_list}. We use them for {purposes} and keep them for {period}. Questions or rights requests: {contact}. You can also complain to the Data Protection Board. Please reply 'read'. {your_name}"
    },
    "watchFor": [
      "Fingerprints, medical and bank details need written consent under a separate job, not this notice."
    ]
  },
  // firm-14 -- Take written consent for sensitive data
  "firm-14": {
    "why": "Fingerprints, medical and bank details are sensitive, and the 2011 privacy rules ask for written consent before you collect them. It also protects staff, and protects you if anyone asks later.",
    "who": "HR or the person who keeps staff files, with the owner approving the wording.",
    "steps": [
      "List each sensitive item you collect from staff, and the reason for each.",
      "Collect only what you truly need. Ask the person what happens if someone says no; invent no consequences.",
      "Draft a short consent form or email for each item: what is taken, why, who sees it, where it is stored, how long.",
      "Get a signature, or a reply email saying 'I agree', before you collect. For existing staff, get it now.",
      "Keep signed forms and emails together in your own folder or drive."
    ],
    "ask": [
      "Are you taking consent on paper forms or by emailed reply?",
      "How many staff have already given written consent, and how many have not?",
      "What will you offer staff who say no?"
    ],
    "proof": "A consent form for each sensitive item, plus signed copies or emails from staff, kept in your own folder or drive.",
    "note": "Written consent taken for {items} by {method}. {done} of {total} staff done. Recorded {date}.",
    "notApplicableWhen": "You collect no fingerprints, medical details or bank details from any staff member.",
    "email": null,
    "watchFor": [
      "A verbal yes is not written consent."
    ]
  },
  // firm-15 -- Publish a privacy policy on the website
  "firm-15": {
    "why": "Visitors want to know what happens to the details they type and the cookies they accept. The 2011 privacy rules ask a business to publish a privacy policy online.",
    "who": "The website firm publishes it; someone inside gives the facts and approves it.",
    "steps": [
      "Read the website-data note; if empty, list what the site collects: forms, cookies, analytics, chat, ad tools.",
      "Draft plain wording for the person: what is collected, why, who gets it, how long it is kept, Grievance Officer contact.",
      "Have someone who knows your business read it, ideally a lawyer. Fix anything untrue. It is a draft, not legal advice.",
      "Ask the person to save the final text as a file and attach it to the email below."
    ],
    "ask": [
      "Who updates your website?",
      "Do you already have a policy or old page?"
    ],
    "proof": "The live policy page, linked from every page. Keep its web address and a dated screenshot in your own folder or drive.",
    "note": "Privacy policy live at {url} since {date}, linked from {places}. Published by {firm}.",
    "notApplicableWhen": "You have no website or online page at all.",
    "email": {
      "to": "Website firm",
      "subject": "Please publish our privacy policy",
      "body": "Hello {their_name}, please publish the attached privacy policy on our website by {due_date}, linked from every page footer and beside each form. Reply with the web address once live. Thanks, {your_name}"
    },
    "watchFor": [
      "The policy must match what the site really does; check cookies and forms first."
    ]
  },
  // firm-16 -- Put up a notice wherever there is a camera
  "firm-16": {
    "why": "People walking in should know they are on camera and who to ask about it. The DPDP Act's notice rule asks for this, and a visible sign also avoids surprise and complaints.",
    "who": "The office or facilities manager, with the security agency or CCTV installer.",
    "steps": [
      "Walk the premises and list every camera area: entrances, reception, floors, parking, cash counter.",
      "Draft the sign for the person: CCTV in use, why it is recorded (for example security), and who to ask.",
      "Add where the full notice can be read, such as a QR code, and check it explains rights and complaints to the Data Protection Board.",
      "Print it large, in your visitors' languages, and put one at each entrance and camera area at eye level.",
      "Take a dated photo of each sign and save it in your own folder or drive."
    ],
    "ask": [
      "Which entrances and areas have cameras?",
      "What are the cameras for, such as security?",
      "Is the Grievance Officer the contact for camera questions?",
      "Which languages should the sign use?"
    ],
    "proof": "Signs are up at every camera area. Keep dated photos of each sign in your own folder or drive.",
    "note": "CCTV notices placed at {locations} on {date}. Contact shown: {contact}. Photos kept.",
    "notApplicableWhen": "You have no CCTV cameras at any of your premises.",
    "email": null,
    "watchFor": [
      "A sign hidden behind a door or in tiny print does not help.",
      "Add a sign whenever you add a camera."
    ]
  },
  // firm-17 -- Mask Aadhaar copies — keep only the last 4 digits visible
  "firm-17": {
    "why": "A lost full Aadhaar copy can be misused. Showing only the last four digits limits the harm.",
    "who": "The staff records person, with whoever files Aadhaar copies of staff or customers, and the IT person.",
    "steps": [
      "List where Aadhaar copies sit: paper files, scans, email, shared drives, staff phones.",
      "Ask your CA or lawyer whether any law makes you keep a full copy. Delete or cover nothing until they answer. Lock away any full copy you must keep, and record why.",
      "On paper copies you do not need in full, cover all but the last four digits with an opaque sticker.",
      "On computer copies you do not need in full, print the page, cover all but the last four digits, rescan it, then delete the original file and empty the Recycle Bin.",
      "Ask staff to accept only masked copies from now on."
    ],
    "ask": [
      "Where do Aadhaar copies sit today: paper, computer, email or phones?",
      "Has your CA or lawyer said a law makes you keep any full copy? Which?"
    ],
    "proof": "Masked copies in the files, plus the staff records person's signed declaration, kept in your own folder.",
    "note": "Aadhaar copies checked on {date} by {name}. Places: {places}. All masked to last 4 digits except {exceptions_and_reason}.",
    "notApplicableWhen": "No Aadhaar copy of staff or customers is held anywhere.",
    "email": null,
    "watchFor": [
      "Never paste or upload an Aadhaar copy into an AI chat or a free online masking website.",
      "A black box drawn on a scan can often be lifted off.",
      "Old copies in email, WhatsApp and phone galleries are easily missed."
    ]
  },
  // firm-18 -- Passwords on every computer, access only for those who need it, regular backups
  "firm-18": {
    "why": "Lost laptops, shared logins and failed disks are common causes of leaks and lost data. These basics lower that risk.",
    "who": "The IT and computers person, with the owner deciding who needs access to what.",
    "steps": [
      "List every computer, laptop, server and shared login, and who uses each.",
      "Set a strong password or PIN on each, and switch on screen lock.",
      "Give each person their own login. Remove access to folders and software they do not need.",
      "Back up important data regularly, for example to the cloud plus an external drive kept elsewhere.",
      "Restore one file from the backup to prove it works."
    ],
    "ask": [
      "How many computers and laptops are there, and does each have a password or PIN and screen lock?",
      "Does everyone have their own login, or is one shared, like Tally or Zoho? Which roles can open accounts and staff folders?",
      "How are backups taken, how often, and where are they kept?"
    ],
    "proof": "A short note by the IT person in your own folder: computers secured, access by role, backup method, last restore test.",
    "note": "Password and screen lock on {number} of {total} computers on {date}. Shared logins: {none_or_list}. Access limited to: {who_sees_what}. Backups: {method}, {frequency}, at {where}. Last restore test {date_or_not_yet}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Never type a password into this chat. Passwords on monitors or sent on WhatsApp defeat the purpose.",
      "A backup kept only on the same computer is lost with it."
    ]
  },
  // firm-19 -- Keep a record of who opened personal data — for at least one year
  "firm-19": {
    "why": "A record of who opened which data shows what happened when something goes wrong, and helps you investigate a leak.",
    "who": "The IT and computers person, with the software or hosting firm that holds the records.",
    "steps": [
      "List the systems holding personal data: accounting, HR, email, website, shared drives.",
      "In each, switch on the setting that records who logged in and who opened or changed data.",
      "If a system cannot, ask its provider in writing (draft below), with a reply date before the due date.",
      "Keep the records at least one year, somewhere nobody can edit them."
    ],
    "ask": [
      "Which systems hold personal data? (See your 'where your software keeps data' job.)",
      "Can each show who logged in and who opened or changed records?",
      "How long does each keep those records, and where are they stored?"
    ],
    "proof": "A declaration by the IT person, with each system's proof that access records are on, in your own folder.",
    "note": "Access records switched on in {systems} on {date}. Kept for {period} at {where}. Gaps: {systems_without_records}.",
    "notApplicableWhen": null,
    "email": {
      "to": "Software or hosting firm",
      "subject": "Access records for {org}",
      "body": "Dear {their_name}, {org} uses {system}. Please tell us whether it records who opens, changes or downloads our records, how to switch that on, and whether we can keep them for at least one year. Please reply by {reply_by}. Regards, {your_name}"
    },
    "watchFor": [
      "Some tools erase records after a short time. Check the default."
    ]
  },
  // firm-20 -- Write down what to do if data leaks — tell the Board and every person affected, full report within 72 hours
  "firm-20": {
    "why": "A leak handled in a panic gets worse. The DPDP law says to tell the Data Protection Board and each affected person, and a written plan makes that possible.",
    "who": "The Grievance Officer (responsible for DPDP policy), with the owner and the IT person.",
    "steps": [
      "Write one page on what counts as a leak: lost laptop, wrong email, hacked account, stolen files.",
      "Name who leads, who checks IT, and who speaks to affected people. Add phone numbers.",
      "List first actions: cut off access, change passwords, note the time you found out, keep evidence.",
      "Prepare a fill-in message for affected people, to go out without delay: what happened, what data, what you are doing, whom to contact.",
      "Prepare a fill-in first notice for the Data Protection Board, then plan the full report within 72 hours.",
      "Share the plan with staff and practise it once."
    ],
    "ask": [
      "Who will lead if data leaks, and who is the backup?",
      "Who checks IT and can say what was lost?",
      "Where will the plan be kept?"
    ],
    "proof": "A one-page leak plan with names, phone numbers and draft messages in your own folder, plus the date staff were told. Declaration by the Grievance Officer.",
    "note": "Leak plan written {date}. Lead {name}, backup {name}, IT contact {name}. Kept at {where}. Staff told {date_or_not_yet}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Waiting to be sure before acting loses time. Note when you first found out."
    ]
  },
  // firm-21 -- Check your own laptop and phone for customer data — never forward it on personal WhatsApp
  "firm-21": {
    "why": "Customer details often sit on personal phones, WhatsApp chats and downloads. A lost phone then exposes them.",
    "who": "Every staff member checks their own devices; the owner sends the request and keeps the replies.",
    "steps": [
      "Owner: send the email below to all staff, with a reply date before the due date.",
      "Staff: search your phone (WhatsApp chats, gallery, downloads, email, notes) and laptop (desktop, downloads, documents, attachments).",
      "Move what the office needs to the office system, then delete your copy.",
      "Stop forwarding customer details on WhatsApp. Use office email or software."
    ],
    "ask": [
      "Are you the owner, or a staff member checking your own devices?",
      "Do customer names, numbers or documents sit on your personal phone or laptop, including in WhatsApp?"
    ],
    "proof": "Each staff member's emailed or signed confirmation that devices were checked, kept in your own folder.",
    "note": "Owner: check requested {date}, {number} of {total} staff confirmed. Staff: devices checked {date}, customer data {moved_deleted_or_none_found}.",
    "notApplicableWhen": "No one uses a personal phone or laptop for work, or sends customer details on personal WhatsApp.",
    "email": {
      "to": "All staff",
      "subject": "Check your devices by {reply_by}",
      "body": "Dear team, please search your own phone and laptop, including WhatsApp and downloads, for customer details. Move what we need to our office email or software, then delete your copy. Do not forward customer details on personal WhatsApp. Please confirm by {reply_by}. Thanks, {your_name}"
    },
    "watchFor": [
      "Deleting a chat does not remove photos and files saved separately."
    ]
  },
  // firm-22 -- Website firm signs the data agreement
  "firm-22": {
    "why": "The firm running your website can see visitor enquiries. A signed agreement makes it promise to protect them.",
    "who": "The owner or website manager, who must get the website firm to sign.",
    "steps": [
      "Write a one-page agreement: enquiries used only for your work, kept secure, leaks reported, deleted or returned at the end. The AI can draft it.",
      "Have your CA or lawyer check it before you sign.",
      "Sign it, attach it to the email below and send it, with a reply date well before the due date.",
      "If no reply, phone them. File the signed copy in your own folder."
    ],
    "ask": [
      "Which firm builds, hosts or looks after your website?",
      "Is there already a signed agreement? Does it cover the same points?"
    ],
    "proof": "The agreement signed by both sides, as a PDF or scan in your own folder.",
    "note": "Data agreement sent by {your_name} to {firm_name} on {date}. Signed copy: {received_on_date_or_awaited}. Filed at {where_or_not_yet}.",
    "notApplicableWhen": "No outside firm builds, hosts or looks after the website.",
    "email": {
      "to": "The website firm",
      "subject": "Data agreement for {org} website",
      "body": "Dear {their_name}, please sign the attached data agreement. It says visitor enquiries from our website are used only for our work, kept secure, reported to us if leaked, and deleted or returned at the end. Please return it by {reply_by}. Regards, {your_name}, {org}"
    },
    "watchFor": [
      "A signed quotation or invoice is not a data agreement."
    ]
  },
  // firm-23 -- Payroll firm signs the data agreement
  "firm-23": {
    "why": "Your payroll firm sees staff bank details, PAN and salary. Careless handling would harm your staff.",
    "who": "The owner or accounts head, who must get the payroll firm to sign.",
    "steps": [
      "Write an agreement: details used only for your payroll, kept secure, not shared, leaks reported, deleted or returned. The AI can draft it.",
      "Have your CA or lawyer check it before you sign.",
      "Sign it, attach it to the email below and send it, with a reply date well before the due date.",
      "If no reply, phone them. File the signed copy in your own folder."
    ],
    "ask": [
      "Which firm runs your payroll, and which staff details does it receive?",
      "Is there already a signed agreement? Does it cover the same points?"
    ],
    "proof": "The agreement signed by both sides, as a PDF or scan in your own folder.",
    "note": "Data agreement sent by {your_name} to {firm_name} on {date}. Signed copy: {received_on_date_or_awaited}. Filed at {where_or_not_yet}.",
    "notApplicableWhen": "Salaries are run in house; no outside firm, accountant or cloud payroll software holds staff details.",
    "email": {
      "to": "The payroll firm",
      "subject": "Payroll data agreement: {org}",
      "body": "Dear {their_name}, please sign the attached data agreement. It says salary, PAN and bank details are used only for our payroll, kept secure, not shared, reported to us if leaked, and deleted or returned at the end. Please return it by {reply_by}. Regards, {your_name}, {org}"
    },
    "watchFor": [
      "Ask whether the payroll firm's software firm is bound too."
    ]
  },
  // firm-24 -- Group company signs a data-sharing agreement
  "firm-24": {
    "why": "Records shared with a group company leave your hands. A signed agreement limits their use.",
    "who": "The owner, who must get the group company to sign.",
    "steps": [
      "List which records go to the group company, and why.",
      "Share only what it truly needs, and only with the person's consent or for a contract with them.",
      "Write an agreement (the AI can draft it): stated purpose, same protection as yours, no passing on, leak notice, deletion.",
      "Have your CA or lawyer check it. Sign it and send it with the email below, with a reply date before the due date.",
      "If no reply, phone them. File the signed copy in your own folder."
    ],
    "ask": [
      "Which group company, which records, and for what purpose?",
      "Is there already a signed agreement? Does it cover the same points?"
    ],
    "proof": "The agreement signed by both companies, as a PDF or scan in your own folder.",
    "note": "Agreement sent by {your_name} to {group_company} on {date}. Signed copy: {received_on_date_or_awaited}. Filed at {where_or_not_yet}.",
    "notApplicableWhen": "No customer or staff records go to any group, parent or sister company.",
    "email": {
      "to": "Group company management",
      "subject": "Data-sharing agreement: {org}",
      "body": "Dear {their_name}, {org} shares {records} with you for {purpose}. Please sign the attached agreement: records used only for that purpose, kept as safe as ours, not passed on, leaks reported, deleted when done. Please return it by {reply_by}. Regards, {your_name}"
    },
    "watchFor": [
      "Shared spreadsheets and common software logins are sharing too."
    ]
  },
  // firm-25 -- Check where your software keeps data — Tally, Zoho, Google — and whether it is outside India
  "firm-25": {
    "why": "Your accounts, staff and customer details may sit on servers abroad without anyone noticing. The Government may restrict sending some data abroad.",
    "who": "The IT and computers person, with the accounts person and the owner.",
    "steps": [
      "List every software and online service you use: accounting, payroll, HR, email, cloud storage, website.",
      "For each, note what personal data goes in: customers, staff, bank, PAN.",
      "Find the country where its data is kept on the vendor's own help page, privacy page or account settings. Do not guess it from memory.",
      "If unclear, ask its support in writing. Mark each India or outside India.",
      "Keep the list and update it when you add new software."
    ],
    "ask": [
      "Which software and online services do you use for accounts, staff, customers, email and files?",
      "Which of them are online rather than installed on your own computers?",
      "For any of them, do you know the country where the data is kept?"
    ],
    "proof": "A list in your own folder: each software, what personal data it holds, where it is kept, and the date checked. Declaration by the IT person.",
    "note": "Software list made {date}: {number} tools checked. In India: {list}. Outside India: {list}. Unclear, vendor asked: {list}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Desktop Tally files sit on your own computer, but cloud, sync and backup copies may be elsewhere.",
      "Free Google or WhatsApp tools count as software too."
    ]
  },
  // firm-26 -- Publish how people can ask to see, correct or delete their data
  "firm-26": {
    "why": "People whose data you hold can ask what you have, fix mistakes or ask for deletion. The DPDP rules say you must publish how they can ask.",
    "who": "The Grievance Officer (responsible for DPDP policy), with whoever manages the website and front desk.",
    "steps": [
      "Choose one email address and one phone number for such requests, and name who reads them.",
      "Write a short notice in simple words: how to ask to see, correct or delete data, and whom to write to.",
      "Publish it where people will see it: website footer or privacy page, notice board, forms.",
      "Tell front-desk staff where the notice is and to pass requests on promptly.",
      "Open a simple register: date received, what was asked, date answered."
    ],
    "ask": [
      "Which email address and phone number should people use for these requests?",
      "Where will you publish the notice: website page, notice board, forms?",
      "Who will read the request inbox?"
    ],
    "proof": "The published notice (website page or photo of the notice board) with its date, plus the blank request register, in your own folder. Declaration by the Grievance Officer.",
    "note": "Request notice published {date} at {where}. Contact: {email}, {phone}. Handled by {role}. Register opened {date}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "An inbox nobody checks is worse than none.",
      "Ask only for the minimum needed to check who is asking.",
      "Do not promise a reply time in the notice unless the Grievance Officer confirms it."
    ]
  },
  // firm-27 -- Answer every complaint within 90 days — within one month under today’s law
  "firm-27": {
    "why": "The law sets a time limit for answering data complaints. A tracked process helps you meet it and shows you acted.",
    "who": "The Grievance Officer (responsible for DPDP policy), with the owner and any staff who receive complaints.",
    "steps": [
      "Set up one complaint register: date, complainant, issue, action taken, date replied.",
      "Tell all staff to pass any data complaint to the Grievance Officer straight away.",
      "Reply in writing in simple words, saying what you did or why you cannot.",
      "Set a reminder at the halfway point of the one-month limit, so nothing gets stuck.",
      "Make sure the Grievance Officer's name and contact details are on your website."
    ],
    "ask": [
      "Have you had any complaints about personal data? Roughly how many, and are any open?",
      "Are the Grievance Officer's name and contact already on your website?",
      "Where will you keep the complaint register?"
    ],
    "proof": "The complaint register in your own folder, showing each complaint, date received and date answered, with a declaration by the Grievance Officer that all were answered in time.",
    "note": "Complaint register opened {date} at {where}. Complaints so far {number}, open {number}. Officer details on website: {yes_or_no}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "The job name gives two limits: one month under today's law, 90 days under the new law. Work to one month.",
      "Complaints also arrive by phone, WhatsApp and at the counter. Write them down too."
    ]
  },
  // firm-28 -- Delete a customer’s data when they ask or when it is no longer needed — and tell anyone you shared it with
  "firm-28": {
    "why": "Keeping customer data longer than needed only adds risk. Delete it, and make outside firms do the same.",
    "who": "The customer data person, with IT and accounts.",
    "steps": [
      "If a customer asked, check it is really them.",
      "List where customer data sits (software, spreadsheets, email, paper, backups, outside firms) and any records no longer needed.",
      "Ask your CA or lawyer if any law makes you keep records, such as tax records. Delete nothing until they answer.",
      "Delete the rest everywhere, including exports and downloads. Keep a deletion note without the data.",
      "Ask each outside firm holding a copy to delete it too and reply in writing.",
      "If they asked, tell them what was deleted, what was kept and why."
    ],
    "ask": [
      "Did a customer ask, or is the data no longer needed? What is their reference number?",
      "Which outside firms hold copies?",
      "What must you keep, and for how long, per your CA or lawyer?"
    ],
    "proof": "A deletion note per case in your own folder: deleted, kept and why, firms told.",
    "note": "Deleted on {date} ({reason}). Ref {reference_number}. Places: {places}. Kept: {what_and_why}. Firms told {firms} on {date}; replies: {status}.",
    "notApplicableWhen": null,
    "email": {
      "to": "Outside firm holding the data",
      "subject": "Deletion request: {org}",
      "body": "Dear {their_name}, {org} shared customer records with you for {purpose}. Please delete {records} from your systems and copies, and confirm in writing by {reply_by}. Regards, {your_name}"
    },
    "watchFor": [
      "Keep the customer's name out of notes; use a reference number."
    ]
  },
  // firm-29 -- Owner confirms all the answers are true
  "firm-29": {
    "why": "Your organisation stays responsible for following the data rules, even when work is handed to others. A false 'done' gives false comfort.",
    "who": "The owner, with the Grievance Officer and the IT person showing their proof.",
    "steps": [
      "Ask the AI to read the job list and show: done jobs with no note, not-applicable reasons, open jobs missing a person or date.",
      "For each done job, check the proof exists in your folder. Ask whether each not-applicable reason is true for you.",
      "Ask the people who did each job about anything you doubt. Reopen it on your page if needed.",
      "When satisfied, confirm the answers yourself on your own page. The AI only prepares a draft."
    ],
    "ask": [
      "Have you personally seen the proof for the jobs marked done, or only been told?",
      "Is any job marked done or not applicable one you are unsure about?"
    ],
    "proof": "The owner's own confirmation on their page, with the date. Save the job list page as a PDF that day in your own folder.",
    "note": "Owner reviewed all answers on {date}. Doubtful, to reopen: {list}. Still open: {list}. Owner to confirm on own page by {due_date}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Do not confirm on a colleague's word. Look at the proof.",
      "Confirming says your answers are true. It does not mean the law is met.",
      "A job you are unsure about is better left open than marked done."
    ]
  },
  // firm-30 -- CA manager checks the proof
  "firm-30": {
    "why": "A second person looking at the proof catches gaps before the file is signed. This is good practice for a careful firm.",
    "who": "The CA manager, after the owner has confirmed, with the people who did each job showing their proof.",
    "steps": [
      "Check the owner's confirmation job first. If it is not confirmed, add a note that you are waiting, and stop.",
      "For each job marked done, open the proof in the folder and check it matches what the job says.",
      "Check that the proof is dated and shows who signed or did it.",
      "Write a short comment on each job checked, and tell the person responsible about any gap.",
      "When gaps are closed, confirm your check yourself on your own page."
    ],
    "ask": [
      "Do you have access to the folder where the proof is kept?",
      "After checking: did you check every job in full, or only a sample?",
      "After checking: which jobs have gaps, and what is missing?"
    ],
    "proof": "A short checking note by the CA manager in your own folder: jobs checked, gaps found, gaps closed, date. Declaration on your page.",
    "note": "CA manager checked proof for {number} jobs on {date}. Method: {full_or_sample}. Gaps: {list}. Closed on {date}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Checking that a file exists is not the same as checking what it says.",
      "This is an internal check, not an audit or a legal opinion.",
      "Never upload proof documents into this chat."
    ]
  },
  // firm-31 -- CA partner signs the file
  "firm-31": {
    "why": "The partner's signature shows a senior person has looked over the whole file. This is good practice and the firm's own internal record, not an audit report or a legal opinion.",
    "who": "The CA partner, after the CA manager has finished checking the proof.",
    "steps": [
      "Read the CA manager's job and its note. If that job is not done, say so and wait.",
      "Check every gap is closed or has a written reason.",
      "Read the summary of the file (all your jobs and answers): done, not applicable with reasons, and anything still open.",
      "Ask the manager about anything unclear. Do not sign on trust alone.",
      "Sign and date the file yourself on your own page. Keep any signed printout in your folder."
    ],
    "ask": [
      "Are you satisfied with the manager's checking note?",
      "Is there anything in the file you want the manager to explain before you sign?",
      "Do you want to sign now or hold the file for another look?"
    ],
    "proof": "The partner's signed and dated sign-off, on the page and as a printout or scan in your own folder, with the manager's checking note.",
    "note": "CA partner reviewed the file on {date}. Open items: {list}. Sign-off on own page: {date_or_pending}. Signed copy kept at {where}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Do not sign before the manager's check is done.",
      "Do not sign with open items that have no written reason."
    ]
  },
  // institution-01 -- Name the Grievance Officer (responsible for DPDP policy)
  "institution-01": {
    "why": "Parents, staff and students need one named person to ask and to complain to. The law asks for a named contact and a way to raise grievances.",
    "who": "The Grievance Officer (responsible for DPDP policy), chosen by the principal or management. The school office supplies an official email and phone.",
    "steps": [
      "Pick a senior, reachable staff member to answer questions and complaints about personal data.",
      "Ask that person to accept the role, and choose a backup for leave days.",
      "Set an official school email and phone for the role, not a personal number.",
      "Decide how complaints arrive: email, a form, or the office desk.",
      "Write the name, role, email, phone and appointment date on a one-page note."
    ],
    "ask": [
      "Who will be the Grievance Officer, and what is their role?",
      "Which official email and phone should people use to reach them?",
      "Who covers when they are away, and how will complaints arrive: email, form or office desk?"
    ],
    "proof": "A signed one-page appointment note with name, role, email, phone and date, kept in your own folder or drive. Then confirm the Yes on your own page.",
    "note": "Grievance Officer is {name}, {role}, {email}, {phone}. Backup is {backup_name}. Complaints via {channel}. Appointed {date}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Do not use a personal email or number that leaves with the person.",
      "Do not name someone who cannot act on a complaint."
    ]
  },
  // institution-02 -- Name a DPDP coordinator
  "institution-02": {
    "why": "Data protection touches admissions, fees, staff, buses and photos, so one coordinator keeps every job moving. This is good practice, not a named legal duty.",
    "who": "The DPDP coordinator, chosen by the principal. The Grievance Officer and the heads of admission, fees, transport and staff records work with them.",
    "steps": [
      "Choose an organised staff member who has time each week to chase jobs across offices.",
      "Get the principal's agreement, and tell office heads this person will follow up with them.",
      "Fix a short regular check-in, for example every two weeks, to review pending jobs.",
      "Write the name, role and email on a note and share it with staff."
    ],
    "ask": [
      "Who will be the DPDP coordinator, and what are their role and official email?",
      "Is this the same person as the Grievance Officer named on that job?",
      "How often can they meet the office heads?"
    ],
    "proof": "A short note naming the coordinator with role, email and start date, kept in your own folder or drive. Then confirm the Yes on your own page.",
    "note": "DPDP coordinator is {name}, {role}, {email}. Named {date}. Check-ins {frequency}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Pick someone with time; a busy principal alone will let jobs slip.",
      "Naming is not enough; the coordinator must actually follow up."
    ]
  },
  // institution-03 -- Publish the Grievance Officer’s name and contact — on the school website or a free VERIDIAN page
  "institution-03": {
    "why": "Parents and staff cannot raise a concern if they do not know whom to contact.",
    "who": "The Grievance Officer (responsible for DPDP policy), with whoever manages the school website.",
    "steps": [
      "Read the officer's name, role, email and phone from the 'Name the Grievance Officer' job; ask only if missing.",
      "Draft a short contact block with those details.",
      "Choose where it goes: the school website, or the free VERIDIAN page option.",
      "Ask the website manager to publish it, or use the free VERIDIAN page option on your own page. The AI cannot do this.",
      "Open the public page in a fresh browser tab and check every detail."
    ],
    "ask": [
      "Does the school have a website, and who can edit it?",
      "Has the Grievance Officer approved the email and phone to show publicly?",
      "Once it is live, what is the page address?"
    ],
    "proof": "The page is live with the officer's name, role, email and phone. Keep a dated screenshot in your own folder or drive.",
    "note": "Grievance Officer contact published at {page_address} on {date}, showing {name}, {email}, {phone}.",
    "notApplicableWhen": null,
    "email": {
      "to": "Website manager",
      "subject": "Please publish our Grievance Officer contact",
      "body": "Dear {their_name}, please add this to a visible page of {org}'s website: Grievance Officer: {name}, {role}, {email}, {phone}. Please send me the page address once it is live, by {due_date}. Thank you, {your_name}"
    },
    "watchFor": [
      "Do not publish a personal mobile number.",
      "Do not bury it deep in a menu."
    ]
  },
  // institution-04 -- Write down where it is kept — ERP, admission files, UDISE+ — and who can open it
  "institution-04": {
    "why": "You cannot protect student data you cannot find. This list shows where it sits and who can open it.",
    "who": "The Admission office, with the ERP administrator or vendor.",
    "steps": [
      "If an ERP vendor runs your system, send it the draft email now; replies take days.",
      "List every place student details are kept: ERP, admission files, UDISE+ data, spreadsheets, WhatsApp groups.",
      "For each place, write what is kept: name, date of birth, photo, address, Aadhaar, marks, attendance, health, category.",
      "Write who can open each place, by role and not by password.",
      "Mark places where Aadhaar or health details are open to more people than needed."
    ],
    "ask": [
      "Which systems and paper files hold student details?",
      "Which staff roles can open each one?",
      "Do outside vendors or apps also hold this data?"
    ],
    "proof": "A table of place, what it holds and who can open it, in your own folder or drive. Put no real student data in it.",
    "note": "Student data held in {places}. Open to {roles}. Vendors: {vendors}. Mapped {date}.",
    "notApplicableWhen": null,
    "email": {
      "to": "ERP vendor or IT administrator",
      "subject": "Request: user roles in our school ERP",
      "body": "Dear {their_name}, {org} is listing where student details are kept. Please send the user roles, which screens each can open, and where our data is hosted. Please send no student data. Reply by {due_date}. Thank you, {your_name}"
    },
    "watchFor": [
      "Do not forget paper files and staff WhatsApp groups.",
      "Shared logins hide who opened a record."
    ]
  },
  // institution-05 -- Write down where it is kept and who can open it
  "institution-05": {
    "why": "Fee and parent contact details spread across fee software, receipt books and staff phones. Knowing where they sit helps stop leaks.",
    "who": "The Fees office, with the accountant and whoever runs the fee software.",
    "steps": [
      "If a provider runs your fee software, send it the draft email now; replies take days.",
      "List each place parent details are kept: fee software, receipt books, sheets, parent app, staff phones.",
      "Write what each holds: name, phone, email, occupation, income.",
      "Write who can open each place, by role.",
      "Check whether occupation and income are needed at all, or only for concessions."
    ],
    "ask": [
      "Which systems, sheets or apps hold parent details?",
      "Which roles can open them?",
      "Why does the school collect income and occupation?"
    ],
    "proof": "A one-page table of places, what each holds and who can open it, in your own folder or drive, with no real parent data.",
    "note": "Parent data held in {places}. Open to {roles}. Income used for {purpose}. Recorded {date}.",
    "notApplicableWhen": null,
    "email": {
      "to": "Fee software provider or accountant",
      "subject": "Request: who can open parent data in our fee system",
      "body": "Dear {their_name}, {org} is recording where parent details are kept. Please tell me which roles can see parent phone, email, occupation and income. Please send no actual parent data. Reply by {due_date}. Thank you, {your_name}"
    },
    "watchFor": [
      "Do not overlook staff phones and receipt books.",
      "Old fee sheets emailed around leak easily."
    ]
  },
  // institution-06 -- Write down where it is kept and who can open it
  "institution-06": {
    "why": "Staff files hold PAN, Aadhaar, bank and medical details. A leak hurts staff directly.",
    "who": "Staff records, with the accountant or payroll provider.",
    "steps": [
      "If an outside firm handles payroll or accounts, send it the draft email now.",
      "List each place staff details are kept: payroll software, files, accountant's system, spreadsheets.",
      "Write what each holds: name, PAN, Aadhaar, bank account, salary, medical.",
      "Write who can open each place, by role.",
      "Mark places where salary or medical details are open to more people than needed."
    ],
    "ask": [
      "Where are staff files, paper and digital, kept?",
      "Which roles can open salary, bank and medical details?",
      "Does an outside firm handle payroll, PF or tax filing?"
    ],
    "proof": "A one-page table of places, what each holds and who can open it, in your own folder or drive, with no actual staff details.",
    "note": "Staff data held in {places}. Open to {roles}. Outside firms: {firms}. Recorded {date}.",
    "notApplicableWhen": null,
    "email": {
      "to": "Payroll provider or accountant",
      "subject": "Request: where our staff data is kept",
      "body": "Dear {their_name}, {org} is recording where staff details are kept. Please tell me where you store our staff PAN, Aadhaar, bank, salary and medical details and who at your firm can open them. Please send no data itself. Reply by {due_date}. Thank you, {your_name}"
    },
    "watchFor": [
      "Do not forget Aadhaar photocopies in cupboards.",
      "Salary sheets on shared drives or group chats."
    ]
  },
  // institution-07 -- Write down where they are — school phones, website, magazine, Instagram
  "institution-07": {
    "why": "Children's photos end up on phones, the website, the magazine and Instagram. If you do not know where, you cannot remove one when a parent asks.",
    "who": "The DPDP coordinator, with teachers, the magazine team and whoever runs the website and Instagram.",
    "steps": [
      "Send the draft email to teachers, the magazine team and the social media handler now.",
      "List every place photos and videos are kept: school phones, cameras, drives, website, magazine, Instagram, WhatsApp groups.",
      "Write who posts to each place and who can see or download from it.",
      "Mark which places are public and which are private."
    ],
    "ask": [
      "Which phones, drives and accounts hold children's photos and videos?",
      "Who runs the website and Instagram?",
      "Do teachers keep photos on personal phones or WhatsApp groups?"
    ],
    "proof": "A table of places, public or private, who can post and who can see, in your own folder or drive. Do not copy the photos.",
    "note": "Photos and videos held in {places}. Public: {public_places}. Managed by {names}. Recorded {date}.",
    "notApplicableWhen": null,
    "email": {
      "to": "Teachers, magazine team and social media handler",
      "subject": "Please tell me where children's photos are kept",
      "body": "Dear all, {org} is listing where student photos and videos are kept or shared. Please reply with the places you use, including personal phones, and whether they are public. Please do not send the photos. Reply by {due_date}. Thank you, {your_name}"
    },
    "watchFor": [
      "Personal phones and WhatsApp groups are easy to miss."
    ]
  },
  // institution-08 -- Write down what the bus system records and who can see it
  "institution-08": {
    "why": "A bus system knows where children are and where they live. The law has special rules on tracking children, with limited exceptions for schools, so know what is recorded.",
    "who": "The Transport in-charge, with the bus GPS or app provider.",
    "steps": [
      "If a provider runs the bus system, send it the draft email now.",
      "Find out what it records and how long history is kept, such as live location, pickup address, parent phone.",
      "Write who can see it: transport staff, drivers, office, parents, the provider.",
      "Check parents see only their own child's bus.",
      "Write the purpose, for example safety."
    ],
    "ask": [
      "Which bus system is used, and which company provides it?",
      "Who can see live location and pickup addresses, and how long is history kept?"
    ],
    "proof": "A one-page note of what it records, why, who can see it and how long it is kept, in your own folder.",
    "note": "Bus system {system} records {data}. Visible to {roles}. History kept {period}. Purpose {purpose}. Recorded {date}.",
    "notApplicableWhen": "The school has no bus service at all, own or hired. Buses without GPS still count.",
    "email": {
      "to": "Bus GPS or transport app provider",
      "subject": "Request: what our bus system records",
      "body": "Dear {their_name}, {org} is documenting our bus system. Please tell me what it records, who can see live location and parent phones, and how long history is kept. Reply by {due_date}. Thank you, {your_name}"
    },
    "watchFor": [
      "Live location visible to all staff or all parents."
    ]
  },
  // institution-09 -- Write down where recordings are kept and for how long
  "institution-09": {
    "why": "CCTV films children and staff daily. Footage kept too long, or seen by anyone, can be misused or leaked.",
    "who": "The CCTV in-charge, with the installer or vendor.",
    "steps": [
      "List where cameras are; check none point at toilets or changing rooms.",
      "Find where recordings are stored: recorder box, cloud, or phone app.",
      "Find how many days the recorder keeps footage before overwriting.",
      "Write who can view or download footage, and who approves a request.",
      "First save footage of any open complaint or incident. Then agree a keeping period with the principal; check no rule needs longer."
    ],
    "ask": [
      "Where are recordings stored, and who installed the system?",
      "How many days are kept before overwriting?",
      "Who can view footage?"
    ],
    "proof": "A one-page note of camera areas, where footage is stored, days kept and who can view it, in your own folder.",
    "note": "CCTV footage stored at {location}. Kept {days} days. Viewable by {roles}. Recorded {date}.",
    "notApplicableWhen": "The school has no CCTV cameras at all.",
    "email": {
      "to": "CCTV installer or vendor",
      "subject": "Request: CCTV storage and keeping period",
      "body": "Dear {their_name}, {org} is recording how our CCTV works. Please confirm where recordings are stored, how many days are kept, who has login access, and how that period can be changed. Reply by {due_date}. Thank you, {your_name}"
    },
    "watchFor": [
      "Default settings may keep footage longer than you think.",
      "Installer logins left active after setup.",
      "Do not let footage of a live complaint be overwritten."
    ]
  },
  // institution-10 -- Write down how long each is kept — admission and TC registers as your board requires; delete the rest
  "institution-10": {
    "why": "Keeping every record forever piles up risk. Keep registers your board requires and anything else a rule says to keep; delete the rest once the reason ends.",
    "who": "The Admission office, with the principal and every office that holds records.",
    "steps": [
      "List each kind of record: admission forms, TC register, fee records, attendance, staff files, photos, CCTV, bus data.",
      "Find what your board says about keeping admission and TC registers; if unclear, ask the board office.",
      "For other records, check whether a fee, audit or tax rule sets a period. If not, pick the shortest period covering why you hold it.",
      "Write the period and deletion method beside each record; ask vendors holding copies to delete them too.",
      "Set a yearly review date; delete expired records after the principal approves."
    ],
    "ask": [
      "Which board is the school under, and does it give a written period for admission and TC registers?",
      "Has your accountant or auditor said any fee or tax records must be kept longer?",
      "Who will do the yearly clean-up?"
    ],
    "proof": "A table of each record, why kept, how long and how deleted, plus the yearly review date, in your own folder or drive.",
    "note": "Keeping periods set {date} for {records}. Admission and TC registers kept as {board_rule}. Yearly review {review_date}. Owner {name}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Do not delete admission or TC registers your board wants kept.",
      "Copies in emails and on old phones also count."
    ]
  },
  // institution-11 -- Take verifiable consent from a parent at admission — the school exemption covers only tracking for learning and safety, not admission data
  "institution-11": {
    "why": "The law asks for a parent's or guardian's verifiable consent before a child's data is used. The school exemption covers only tracking for learning and safety, not admission data.",
    "who": "The Admission office, with the principal and the ERP vendor for online admission.",
    "steps": [
      "Add a plain consent part to the admission form: what data is used, and why. Keep photo permission separate.",
      "Take the parent's signature on paper, or online with a one-time code sent to their phone.",
      "Check the signer is an adult and the child's parent or guardian, for example by seeing an ID; note only that you checked.",
      "Keep signed forms locked or in a secured folder; note who can open them."
    ],
    "ask": [
      "Are admissions on paper, online, or both?",
      "How does the office check the signer is the parent or guardian?"
    ],
    "proof": "The updated form and each parent's signed or code-confirmed consent, with a note of how identity was checked, in your own folder or drive.",
    "note": "Consent form updated {date}. Taken by {method}. Identity checked by {check}. Owner {name}.",
    "notApplicableWhen": null,
    "email": {
      "to": "ERP vendor (only if admission is online)",
      "subject": "Request: parent consent step in online admission",
      "body": "Dear {their_name}, please add a parent consent part and a separate photo tick to {org}'s online admission form, saving the date. Reply by {due_date}. Thank you, {your_name}"
    },
    "watchFor": [
      "A pre-ticked box or small print is not clear consent.",
      "Do not copy more ID than you need."
    ]
  },
  // institution-12 -- Take a separate Yes or No from parents for photos on the website, magazine and social media
  "institution-12": {
    "why": "Photos on the website, magazine and social media are extras, not part of admission. A parent must be free to say no without the child losing anything.",
    "who": "The DPDP coordinator, with class teachers and whoever runs the website, magazine and Instagram.",
    "steps": [
      "Draft a separate photo form with its own Yes or No for the website, the magazine and social media.",
      "State in plain words what is posted, where, and that a parent can change their answer at any time.",
      "Send it to every parent. Check each answer comes from the parent or guardian, as at admission. Record it per child; blank means No.",
      "Give teachers and the media team the list of No answers before anything is posted.",
      "Set a simple way for a parent to withdraw, and take posts down when they do."
    ],
    "ask": [
      "Which channels does the school post photos on?",
      "Is there a photo permission now, and is it part of the admission form?",
      "Who will keep the list of answers, and how can a parent withdraw?"
    ],
    "proof": "The photo form and a class-wise list of each parent's Yes or No with dates, in your own folder or drive. The media team checks it before posting.",
    "note": "Photo Yes/No form sent {date}. Channels: {channels}. Answers held by {name}. Withdrawal route: {route}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Do not tie photo permission to admission or fee payment.",
      "Do not treat silence as Yes."
    ]
  },
  // institution-13 -- Give parents a notice — what you hold, why, and how to complain
  "institution-13": {
    "why": "Parents should know what the school holds about them and their child, why, and where to complain. The law asks for this notice.",
    "who": "The DPDP coordinator, with the Grievance Officer and the Admission and Fees offices.",
    "steps": [
      "List what the school collects from parents and children, and why, using the earlier 'where it is kept' notes.",
      "Write a one-page notice in simple English and the local language, itemised and separate from other forms.",
      "Add how parents can see, correct or ask to delete their data, the Grievance Officer's contact, and how to complain to the Data Protection Board.",
      "Get the principal to approve it. Give it to current parents now and new parents at admission; post it on the notice board or website.",
      "Note the date and the way it was given: paper, app or email."
    ],
    "ask": [
      "Are any parent or child details missing from the earlier 'where it is kept' notes?",
      "Which outside firms get any of it, such as the fee app, bus provider or exam board?",
      "Which languages can most of your parents read?"
    ],
    "proof": "The approved notice and a dated record of how parents received it, in your own folder or drive.",
    "note": "Parent notice issued {date} in {languages} via {channels}. Approved by {approver}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Do not paste a long generic policy; keep it itemised and short.",
      "Do not leave out outside firms that receive the data."
    ]
  },
  // institution-14 -- Tell staff what you hold and why — no consent is needed for employment
  "institution-14": {
    "why": "Staff should know what the school holds about them and why. No consent is needed for employment use, but people should still be told.",
    "who": "Staff records, with the principal to approve it and the Grievance Officer.",
    "steps": [
      "List the staff data you hold and why each is needed, using the earlier staff 'where it is kept' note.",
      "Write a one-page staff notice in plain words.",
      "Add how staff can ask to see, correct or delete their data, the Grievance Officer's contact, and how to complain to the Data Protection Board.",
      "Say who outside sees staff data, such as payroll or PF firms.",
      "Say that other uses, such as staff photos on social media, need a separate Yes.",
      "Give it to current staff now and new staff on joining; record it."
    ],
    "ask": [
      "Is anything missing from the earlier staff 'where it is kept' note, and what is each item used for?",
      "Which outside firms receive staff data, such as payroll or PF?",
      "How will staff receive the notice: circular, email or at joining?"
    ],
    "proof": "The staff notice and a dated list of who received it, in your own folder or drive.",
    "note": "Staff notice issued {date} via {channel}. Covers {data_items}. Shared with {firms}. Contact {name}, {email}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Do not use staff photos on social media under this notice; ask separately.",
      "Update the notice when a new payroll or attendance system arrives."
    ]
  },
  // institution-15 -- Put up a notice wherever there is a camera
  "institution-15": {
    "why": "Cameras record children and staff, and the DPDP Act has a rule that people are told what is collected, why, how to use their rights and how to complain to the Data Protection Board. A clear sign at each camera area is a sensible way to do this.",
    "who": "The CCTV in-charge, with the head and whoever maintains the cameras.",
    "steps": [
      "Walk the campus and buses and list every camera and what it covers.",
      "Write a sign in English and your local language: cameras record here, why, who to contact, and how to complain to the Data Protection Board.",
      "Fix one sign at each entrance and each camera area, at eye level, large enough to read. Keep the full notice at the front office.",
      "Photograph each sign in place and note the date."
    ],
    "ask": [
      "How many cameras are there, and where: gate, corridors, classrooms, buses?",
      "Who should the sign name as the contact?",
      "What are the cameras for: safety, security or something else?"
    ],
    "proof": "Signs fixed at every camera area. Keep the sign wording and dated photos of each sign in your own folder or drive.",
    "note": "{count} cameras at {places}. Signs fixed {date} naming {contact} and purpose {purpose}. Photos kept in {folder}.",
    "notApplicableWhen": "The institution has no CCTV cameras on its premises or vehicles.",
    "email": null,
    "watchFor": [
      "Signs only at the main gate while cameras run inside.",
      "Sign too small or only in English."
    ]
  },
  // institution-16 -- Mask Aadhaar copies — keep only the last 4 digits visible
  "institution-16": {
    "why": "A photocopy of a full Aadhaar number is easy to misuse if it is lost, copied or seen by the wrong person.",
    "who": "The admission office, with clerks and whoever scans documents.",
    "steps": [
      "Find every place Aadhaar copies sit: admission and staff files, scanned folders, ERP uploads and phones.",
      "Ask the head which copies are still needed (a board or scholarship rule may need one). Mask those; return or shred the rest.",
      "Black out all digits except the last four on paper copies. Re-scan the blacked-out copy and delete the full-number scan, in folders and ERP alike.",
      "From now on, mask copies at the admission counter. Never display a full Aadhaar number on notices or lists."
    ],
    "ask": [
      "Where are Aadhaar copies kept: paper files, computer folders, ERP or phones?",
      "How many files will you spot check after masking?",
      "Who will do the masking?"
    ],
    "proof": "A spot check of sample files shows only the last four digits. Keep a dated note of who checked, in your own folder.",
    "note": "Aadhaar copies found in {places}. Masked by {name} on {date}. Spot check of {count} files passed. New copies masked at intake.",
    "notApplicableWhen": "The institution holds no Aadhaar copies of students or staff, on paper, computers, ERP or phones.",
    "email": null,
    "watchFor": [
      "Masking the paper copy but leaving the full scan on the office computer.",
      "Aadhaar copies forwarded on WhatsApp. Never paste an Aadhaar number or image into an AI chat."
    ]
  },
  // institution-17 -- Passwords on the ERP and every office computer, access only for those who need it, backups
  "institution-17": {
    "why": "One weak or shared password can open every student record. Limited access and backups also let you recover after a mishap.",
    "who": "The IT and computers in-charge, with the head and the ERP vendor helping.",
    "steps": [
      "List every system holding student or staff data: ERP, fee app, office computers, shared drives, and who uses each.",
      "Give each user their own login and a strong password (a long phrase, not a name or birthday). Remove shared and default logins.",
      "Give each person access only to what their work needs. Remove access for people who have left.",
      "Turn on automatic backups, keep one locked or password-protected copy away from the main computer, and test restoring one."
    ],
    "ask": [
      "Which systems hold student or staff data?",
      "Does everyone have their own login, or are some shared?",
      "Where are backups kept, and when was one last restored?"
    ],
    "proof": "A list of systems showing who has access, and the date backups were last tested. Keep it in your own folder or drive. Say Yes only when logins, access and backups are all in place.",
    "note": "Systems: {systems}. Own logins: {yes_no}. Access reviewed {review_date}. Backups at {where}, last tested {test_date}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "One shared login on the fee counter computer, or accounts of former staff left active.",
      "Backups kept on the same machine.",
      "Passwords on sticky notes, or shared on WhatsApp or with the AI."
    ]
  },
  // institution-18 -- Keep a record of who opened student data — for at least one year
  "institution-18": {
    "why": "If a record is opened by the wrong person, a log is how you find out who, when and what. Without one you cannot investigate.",
    "who": "The IT and computers in-charge, with the ERP and fee app vendors.",
    "steps": [
      "Ask your IT person or vendor if the ERP, fee app and office computers log who opened or changed student records (often called 'audit log').",
      "Switch logging on. If a system cannot log, ask its vendor how; if it still cannot, note it as a gap.",
      "Set logs to be kept at least one year, and stop ordinary users from editing or deleting them.",
      "Pick someone to review the logs regularly for odd access, such as late-night logins, and note the date of each review."
    ],
    "ask": [
      "Which systems hold student data, and which already keep an access log?",
      "Who will review the logs, and how often?",
      "Where are logs stored, and for how long?"
    ],
    "proof": "A list of systems with logging on, how long logs are kept, and a dated review note, in your own folder or drive. Say Yes only when logs are kept at least one year.",
    "note": "Logging on for {systems}. Kept {months} months. Reviewer {name}, checked {frequency}. Gaps: {gaps}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Logs that wipe themselves after a few weeks.",
      "Shared logins, so the log cannot show who opened the record."
    ]
  },
  // institution-19 -- Write down what to do if data leaks — tell the Board and every family affected, full report within 72 hours
  "institution-19": {
    "why": "The DPDP Act has a rule to tell each affected family without delay after a leak, and the Data Protection Board with a full report within 72 hours. A written plan makes that possible.",
    "who": "The Grievance Officer leads, with the head, IT support and the front office.",
    "steps": [
      "Name one person to lead in a leak, and a backup. Put their phone numbers on one page.",
      "Write the first actions: cut off the affected account, change passwords, keep evidence, note when you found out.",
      "Draft a plain message for families: what happened, which data, what you are doing, whom to call.",
      "Draft the report to the Data Protection Board (not your school board): what happened, when, which data, how many children, what you did.",
      "Tell staff to report a lost phone, wrong email or hacked account to the lead at once."
    ],
    "ask": [
      "Who leads, and who is the backup?",
      "How will you reach families: SMS, WhatsApp or school app?",
      "Who signs off the report to the Board?"
    ],
    "proof": "A dated one-page plan with names, numbers, first actions and message drafts, known to staff, kept in your own folder or drive.",
    "note": "Leak lead {lead}, backup {backup}. Families reached by {channel}. Board report by {signatory}. Plan dated {date}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Waiting to be sure before telling anyone.",
      "Guessing when the 72 hours start; ask a lawyer.",
      "Making up a Board address; check its official website."
    ]
  },
  // institution-20 -- Check your own laptop and phone for student photos and marks — never share them on personal WhatsApp
  "institution-20": {
    "why": "Children's photos and marks on personal phones can leak if the phone is lost, shared or backed up. Children's data needs extra care.",
    "who": "Each teacher checks their own devices. A coordinator shares these steps with teachers and collects confirmations.",
    "steps": [
      "Search your phone gallery, laptop folders, downloads and email for student photos, mark lists and report cards.",
      "Move what the school needs to the school's ERP or shared drive. Delete your personal copies.",
      "Stop sharing student photos or marks in personal WhatsApp groups. Ask the school for an official channel instead.",
      "Put a passcode on your phone and laptop. Keep student files where family members cannot open them.",
      "Tell the office when you have finished."
    ],
    "ask": [
      "Do you keep student photos or marks on your own phone or laptop?",
      "Which WhatsApp groups do you use with parents or students?",
      "Do your phone and laptop have a passcode?"
    ],
    "proof": "A short dated confirmation from each teacher that devices are checked and cleared. The office keeps these in its own folder or drive.",
    "note": "{teacher} checked devices on {date}. Student photos and marks removed: {removed}. Passcodes set: {passcodes}. Official channel used: {channel}.",
    "notApplicableWhen": "Only if every teacher confirms they never use personal phones or laptops for student matters, or there is no teaching staff; never assume this.",
    "email": null,
    "watchFor": [
      "Photos still in the phone's cloud backup.",
      "Marks sent in a personal WhatsApp group by habit."
    ]
  },
  // institution-21 -- No ads, profiling or tracking of children beyond learning and safety
  "institution-21": {
    "why": "The DPDP Act has a rule against tracking, behaviour monitoring and targeted ads aimed at children, with some room for a school's learning and safety needs. School tools should collect only what those need.",
    "who": "The DPDP coordinator, with teachers, IT and the vendors of your apps.",
    "steps": [
      "List every app, website and tool students use through the school: learning app, ERP, online classes, quiz tools.",
      "Check each tool's settings and privacy page for ads, behaviour scoring or tracking. If unclear, ask the vendor in writing.",
      "Switch off ads and tracking or profiling that learning and safety do not need. If a tool cannot, ask the head about stopping it.",
      "Tell staff: no student or parent lists to marketing or coaching firms, or any outsider, without the head's OK."
    ],
    "ask": [
      "Which apps and websites do students use through the school?",
      "Do any show ads or track what children click?",
      "Have you ever shared student or parent contact lists with anyone outside?"
    ],
    "proof": "A dated list of student-facing tools with Yes or No for ads and tracking, and the settings changed. Keep it in your own folder or drive.",
    "note": "Tools reviewed: {tools}. Ads or tracking found in {flagged_tools}; action {action} on {date}. No marketing use of student data, confirmed by {name}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Free apps often carry ads and tracking by default.",
      "Handing out parents' numbers as a favour."
    ]
  },
  // institution-22 -- Bus firm signs the data agreement — location only during the journey, only for safety
  "institution-22": {
    "why": "Live bus location shows exactly where children are. It should be watched only during the journey and used only for safety.",
    "who": "The bus firm signs. The transport in-charge chases it and the head approves.",
    "steps": [
      "Draft a short agreement: tracking only during school journeys, used only for safety, never shared or sold, leaks reported to you at once.",
      "Have a lawyer check it, if you can.",
      "Email it to the firm yourself with the agreement attached, then get both sides to sign."
    ],
    "ask": [
      "Which firm runs your buses, and who is your contact?",
      "Does another company supply the GPS or the parent tracking app?"
    ],
    "proof": "Agreement signed by both sides and dated, kept in your own folder or drive. Mark done only when you hold the signed copy.",
    "note": "Bus firm {firm}, contact {name}. Agreement signed {date}. Tracking provider {provider}.",
    "notApplicableWhen": "The institution runs no school buses and hires no bus firm.",
    "email": {
      "to": "Bus firm owner or manager",
      "subject": "Data agreement for school bus location",
      "body": "Dear {their_name}, {org} needs an agreement with you on bus location data, attached: location tracked only during school journeys, used only for safety, never shared or sold, any leak told to us at once. Please sign and return it by {due_date}, and tell us which company supplies your GPS. Thank you, {your_name}"
    },
    "watchFor": [
      "Tracking left on after the journey ends.",
      "A separate GPS or app company needs one too."
    ]
  },
  // institution-23 -- School software firm signs the data agreement
  "institution-23": {
    "why": "The software firm holds your students' marks, attendance and fees. A signed agreement binds it to protect them.",
    "who": "The software firm signs; the IT in-charge chases and the head approves.",
    "steps": [
      "List each software firm holding student or parent data: ERP, fee app, attendance app.",
      "Ask each for its data agreement; if none, draft a short one and have a lawyer check it if you can.",
      "Check it says: data used only on your instructions, same safeguards as yours, leaks reported quickly, data returned or deleted at the end.",
      "Get it signed. If a firm will not sign, do not say Yes; note it and take advice."
    ],
    "ask": [
      "Which software firms hold student, parent or fee data?",
      "Has any of them already given you a data agreement?"
    ],
    "proof": "A signed agreement with each software firm, dated, kept in your own folder or drive.",
    "note": "Software firms: {firms}. Agreements signed {dates}. Still pending: {pending}.",
    "notApplicableWhen": "No outside software firm holds student, parent or fee data.",
    "email": {
      "to": "Account manager of the school software firm",
      "subject": "Data agreement for student records",
      "body": "Dear {their_name}, {org} needs a signed data processing agreement for the student and parent data in {product}: used only on our instructions, same safeguards as ours, any leak told to us quickly, data returned or deleted when we end. Please send yours by {due_date}. Thank you, {your_name}"
    },
    "watchFor": [
      "Accepting standard terms without reading the leak and deletion parts."
    ]
  },
  // institution-24 -- Check where your apps keep data — ERP, fee app, WhatsApp groups — and whether it is outside India
  "institution-24": {
    "why": "Student data in apps may sit on servers abroad. Knowing where lets you answer questions and adapt if rules on sending data abroad change.",
    "who": "The IT and computers in-charge, with each app vendor supplying the facts.",
    "steps": [
      "List every app holding student, parent or staff data: ERP, fee app, attendance, cloud drives, email, WhatsApp.",
      "Ask each vendor in writing where the data is stored and whether backups or support staff are outside India.",
      "For WhatsApp and free tools, read their help page; write 'not confirmed' if unsure.",
      "Record answers in a table: app, vendor, location, date asked.",
      "Show the head anything outside India or not confirmed, and re-check yearly."
    ],
    "ask": [
      "Which apps hold student, parent or staff data, including WhatsApp groups?",
      "Which vendors have already told you where data is stored?"
    ],
    "proof": "A dated table of apps, vendors and storage locations, with vendor replies saved, in your own folder or drive.",
    "note": "Apps reviewed: {apps}. Outside India or not confirmed: {outside_or_unknown}. Vendors yet to reply: {pending}. Table dated {date}.",
    "notApplicableWhen": null,
    "email": {
      "to": "Support or account manager of each app vendor",
      "subject": "Where is our student data stored?",
      "body": "Dear {their_name}, {org} uses {product}. Please tell us in writing in which country and city our student data is stored, and whether backups or support staff are outside India. Kindly reply by {due_date}. Thank you, {your_name}"
    },
    "watchFor": [
      "Forgetting WhatsApp and free cloud drives.",
      "Stating a storage location from memory."
    ]
  },
  // institution-25 -- Publish how parents can ask to see, correct or delete their child’s data
  "institution-25": {
    "why": "Parents can ask what you hold about their child, ask for corrections, or ask for deletion. They can only do this if they know how.",
    "who": "The Grievance Officer, with the front office and whoever runs the website.",
    "steps": [
      "Pick one route for requests: a dedicated email, a phone number, or a form at the front office.",
      "Write a short plain notice: parents can ask to see, correct or delete their child's data, though some records must be kept.",
      "Add how to ask, who replies, and that you may ask for proof they are the child's parent or guardian.",
      "Publish it on the website, notice board, admission form and school diary or app.",
      "Tell the front office to pass every such request to the Grievance Officer at once.",
      "Keep a simple register of requests, and check the asker is the child's parent or guardian before sharing anything."
    ],
    "ask": [
      "What email, phone or address should parents use?",
      "Who is the Grievance Officer, by name and role?",
      "Where will you publish it, and where will the request register be kept?"
    ],
    "proof": "The published wording with dated photos or links, and a blank request register ready for use, kept in your own folder or drive.",
    "note": "Parents ask via {route}. Officer {name}. Published on {places} on {date}. Request register kept at {place}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Burying it inside a long policy nobody reads.",
      "An email address nobody checks."
    ]
  },
  // institution-26 -- Answer every complaint within 90 days
  "institution-26": {
    "why": "A parent who complains should get a real answer, not silence. A log and a due date stop complaints slipping.",
    "who": "The Grievance Officer, with a named backup and whoever holds the data complained about.",
    "steps": [
      "Start a complaints log: date received, who, what about, due date, reply date.",
      "For each complaint, to be safe, set the reply-by date 90 days after it first reached anyone at the school.",
      "Use a phone calendar or spreadsheet to work out the date, and add a reminder at the halfway point.",
      "Acknowledge each complaint quickly, look into it with whoever holds the data, and reply in writing.",
      "Record the reply date and outcome. Show the head any complaint still open near its due date."
    ],
    "ask": [
      "Have you received any data complaint already, and when?",
      "Where will the log be kept: register, spreadsheet or ERP?",
      "Who covers when the Grievance Officer is on leave?"
    ],
    "proof": "A complaints log showing each complaint, due date and reply date, or a dated note that none were received. Keep it in your own folder or drive.",
    "note": "Complaints log at {place}. Officer {officer}, backup {backup}. Complaints so far: {count}. All answered in time: {yes_no}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Counting from the date you read it, not the date it first arrived.",
      "Verbal complaints never written down."
    ]
  },
  // institution-27 -- Delete a student’s data when it is no longer needed — keep the registers your board requires
  "institution-27": {
    "why": "Old student data you no longer need is a risk with no benefit. Some registers must still be kept, so sort which is which.",
    "who": "The admission office, with the head and the software firms holding copies.",
    "steps": [
      "Ask your education board and your accountant which registers and fee records you must keep, and for how long. Do not guess.",
      "List other student data you hold: old forms, photos, Aadhaar copies, health forms, CCTV footage, WhatsApp groups.",
      "Set a keep-until rule for each kind, using only periods confirmed by your board, accountant or a lawyer; if unsure, keep it.",
      "Each year, delete or shred what has expired, but never anything tied to an open complaint, dispute or leak.",
      "Ask your ERP and other software firms in writing to delete their copies too.",
      "Record what was deleted and when, by category, without child names."
    ],
    "ask": [
      "Do you already know which registers your board requires, and for how long?",
      "Where do old student records sit: cupboards, ERP, drives, phones?",
      "Who signs off each yearly clean-up?"
    ],
    "proof": "A dated table of data kinds and keep-until rules, plus a record of what each clean-up deleted, by category, in your own folder or drive.",
    "note": "Keep-until table dated {table_date}. Registers kept: {registers}. Last clean-up {cleanup_date} by {name}. Software firms asked: {yes_no}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Deleting a register the board still needs.",
      "Copies left in backups, old phones and WhatsApp."
    ]
  },
  // institution-28 -- Sign off all the answers
  "institution-28": {
    "why": "You can hand out the work, but the institution stays responsible for it. Signing off shows the head looked at every answer.",
    "who": "The owner or head of the institution, with each officer confirming their own jobs.",
    "steps": [
      "Go through the job list and chase every job still open or waiting on an outside firm.",
      "Check every other job is Yes or Not applicable with a reason. Read the notes and confirm a named person answers for each.",
      "Check that each Yes has its record in your own folder or drive.",
      "Confirm the answers yourself on your own page. The AI can only prepare a draft.",
      "Set a yearly reminder to re-check."
    ],
    "ask": [
      "Is there any job you are unsure about or want to re-check before you sign off?",
      "Does each Yes have a record in your own folder or drive?",
      "Who will run the yearly re-check?"
    ],
    "proof": "Every job shows Yes or Not applicable with a dated note, and you have confirmed on your own page. Keep a dated copy of the summary in your own folder.",
    "note": "Owner {name} reviewed all answers on {review_date}. Open items: {list}. Next review {next_review_date}.",
    "notApplicableWhen": null,
    "email": null,
    "watchFor": [
      "Signing off with jobs still waiting on an outside firm.",
      "Sign-off is your own review record. There is no certification, and it is not legal advice."
    ]
  },
}
