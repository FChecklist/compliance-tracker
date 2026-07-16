import type { Metadata } from "next";
import { LegalShell, COMPANY } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Terms & Conditions — VERIDIAN AI OS",
  description: "Terms and Conditions governing the use of VERIDIAN AI OS and all its products.",
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms & Conditions" updated="7 July 2026">
      <section>
        <h2>1. Who we are</h2>
        <p>
          VERIDIAN AI OS and all products offered under it — including VERIDIAN OFFICE AI OS, THE FIRM AI OS,
          VERI FM &amp; CS AI OS, and FORGE (together, the &ldquo;Services&rdquo;) — are owned and operated by{" "}
          <strong>{COMPANY.legalName}</strong>, a company {COMPANY.incorporation} (&ldquo;the Company&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;). By accessing or using the Services you agree to these Terms.
          If you use the Services on behalf of an organisation, you represent that you are authorised to bind it.
        </p>
      </section>

      <section>
        <h2>2. The Services</h2>
        <p>
          The Services are AI-assisted business operating systems. AI-generated outputs are provided to assist
          human decision-making; they may contain errors and do not constitute legal, tax, accounting, or other
          professional advice. You remain responsible for reviewing and approving actions before relying on them,
          and for your organisation&apos;s statutory and regulatory obligations.
        </p>
      </section>

      <section>
        <h2>3. Accounts and acceptable use</h2>
        <ul>
          <li>You must provide accurate information and keep your credentials secure; you are responsible for activity under your account.</li>
          <li>You may not misuse the Services: no unlawful content, no attempts to breach security or tenant isolation, no reverse engineering, no abusive automated access.</li>
          <li>We may suspend or terminate accounts that violate these Terms, with notice where practicable.</li>
        </ul>
      </section>

      <section>
        <h2>4. Fees, offers and discounts</h2>
        <p>
          Fees, where applicable, are stated on the relevant product page or agreed in writing. Promotional codes
          and discounts (including offers presented on our websites) are limited-time, non-transferable, applicable
          only as described at the time of issue, may be withdrawn or varied at our discretion before acceptance,
          and have no cash value. Taxes are additional where applicable.
        </p>
      </section>

      <section>
        <h2>5. Your data and our AI</h2>
        <p>
          You retain all rights in the data you submit. You grant us the licences needed to operate the Services,
          including processing your data through third-party AI model providers. <strong>We use data to train and
          improve our models and systems</strong>, as described in our <a href="/data-policy">Data Policy</a> and{" "}
          <a href="/privacy">Privacy Policy</a>; those documents describe scope, safeguards and the contact for
          objections. Our systems are designed with database-enforced tenant isolation (row-level security),
          session-verified authentication, and encrypted credential storage; we rely on third-party subprocessors
          for hosting, database, and AI infrastructure, each of which publishes its own security and compliance
          documentation.
        </p>
      </section>

      <section>
        <h2>6. Intellectual property</h2>
        <p>
          The Services, including software, design, and branding, are the property of the Company or its licensors.
          These Terms grant you no rights in them other than the right to use the Services as intended.
        </p>
      </section>

      <section>
        <h2>7. Disclaimers and limitation of liability</h2>
        <p>
          The Services are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the maximum extent
          permitted by law, we disclaim all implied warranties, and our aggregate liability arising out of or
          relating to the Services is limited to the fees paid by you for the Services in the twelve months
          preceding the claim. We are not liable for indirect, incidental, special, or consequential losses.
        </p>
        <p>
          <strong>Protection of officers:</strong> the Services are provided solely by the Company as a corporate
          entity. To the maximum extent permitted by law, no director, officer, employee, or shareholder of the
          Company shall have any personal liability arising out of or in connection with the Services, and you
          agree to bring any claim only against the Company.
        </p>
      </section>

      <section>
        <h2>8. Governing law and disputes</h2>
        <p>
          These Terms are governed by the laws of India. Subject to any mandatory law, the courts of India shall
          have exclusive jurisdiction over disputes arising from these Terms or the Services.
        </p>
      </section>

      <section>
        <h2>9. Changes and contact</h2>
        <p>
          We may update these Terms; material changes will be notified through the Services or by email, and
          continued use constitutes acceptance. Questions and notices: <a href={`mailto:${COMPANY.contactEmail}`}>{COMPANY.contactEmail}</a>.
        </p>
      </section>
    </LegalShell>
  );
}
