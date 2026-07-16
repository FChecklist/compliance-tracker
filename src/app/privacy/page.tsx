import type { Metadata } from "next";
import { LegalShell, COMPANY } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy — VERIDIAN AI OS",
  description: "How VERIDIAN AI OS collects, uses, and protects personal data.",
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="7 July 2026">
      <section>
        <h2>1. Controller</h2>
        <p>
          The data controller for VERIDIAN AI OS and its products is <strong>{COMPANY.legalName}</strong>, a
          company {COMPANY.incorporation}. Privacy contact:{" "}
          <a href={`mailto:${COMPANY.contactEmail}`}>{COMPANY.contactEmail}</a>.
        </p>
      </section>

      <section>
        <h2>2. What we collect</h2>
        <ul>
          <li><strong>Account data</strong> — name, email, organisation name, and authentication records when you sign up.</li>
          <li><strong>Business data</strong> — the content your organisation puts into the Services (records, documents, messages, tasks).</li>
          <li>
            <strong>Website analytics</strong> — on our public pages we assign a random, self-generated visitor
            identifier (stored in your browser&apos;s local storage; it contains no personal details) and record
            which pages and sections you view, links you click, when you leave, and any promotional offers shown
            to you. We use this to understand where visitors lose interest and to present relevant offers. No
            name or email is collected before you sign up.
          </li>
          <li><strong>Technical data</strong> — IP address, browser type, and referral source, from standard server logs.</li>
        </ul>
      </section>

      <section>
        <h2>3. How we use it</h2>
        <ul>
          <li>To provide, secure, and support the Services.</li>
          <li>To analyse and improve our websites and conversion journeys, including customized offers.</li>
          <li>
            <strong>To train and improve our models and systems.</strong> We use data to make our AI more accurate
            and useful. Safeguards and the scope of this use are set out in our <a href="/data-policy">Data Policy</a>;
            you may object or seek exclusions by contacting us.
          </li>
          <li>To comply with law and enforce our terms.</li>
        </ul>
      </section>

      <section>
        <h2>4. Third parties and international transfers</h2>
        <p>
          We use third-party service providers to run the Services — including cloud hosting and database
          infrastructure (Vercel, Supabase) and AI model providers reached through our model-routing layer. These
          subprocessors publish their own security and compliance documentation, which we encourage you to review
          directly. Our own systems are designed with database-enforced tenant isolation (row-level security),
          encrypted storage of API credentials, and session verification on every authenticated route — see
          Section 5 below. Where data is transferred internationally, it is protected by appropriate safeguards
          such as standard contractual clauses offered by our providers.
        </p>
      </section>

      <section>
        <h2>5. Security and retention</h2>
        <p>
          Data is protected with encryption in transit, tenant isolation enforced at the database layer
          (row-level security), encrypted storage of API credentials, and audit logging of system actions. We
          retain data for as long as your account is active or as needed for the purposes above, then delete or
          anonymise it within a reasonable period.
        </p>
      </section>

      <section>
        <h2>6. Your rights</h2>
        <p>
          Subject to applicable law (including the GDPR where it applies and India&apos;s data protection
          framework), you may request access, correction, deletion, portability, or restriction of your personal
          data, and object to certain processing including use of your data for model training. Write to{" "}
          <a href={`mailto:${COMPANY.contactEmail}`}>{COMPANY.contactEmail}</a>; we respond within the timelines
          required by law. This address also serves as the grievance contact under applicable Indian law.
        </p>
      </section>

      <section>
        <h2>7. Changes</h2>
        <p>
          We may update this policy; material changes will be posted here with a new date and, where appropriate,
          notified through the Services.
        </p>
      </section>
    </LegalShell>
  );
}
