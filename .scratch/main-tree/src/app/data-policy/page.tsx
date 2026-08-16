import type { Metadata } from "next";
import { LegalShell, COMPANY } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Data Policy — VERIDIAN AI OS",
  description: "How VERIDIAN AI OS handles, isolates, and learns from data — including model training.",
};

export default function DataPolicyPage() {
  return (
    <LegalShell title="Data Policy" updated="7 July 2026">
      <section>
        <h2>1. Ownership</h2>
        <p>
          Your organisation owns its data. <strong>{COMPANY.legalName}</strong> processes it only to operate,
          secure, and improve the Services. Nothing in this policy transfers ownership of your business data to us.
        </p>
      </section>

      <section>
        <h2>2. Tenant isolation</h2>
        <p>
          Every organisation&apos;s data is isolated at the database layer through row-level security enforced by
          the database itself, not only by application code. Cross-tenant access is structurally prevented, and
          platform-level operations run under separately controlled roles. AI response caching is scoped per
          organisation so one tenant&apos;s AI outputs can never be served to another.
        </p>
      </section>

      <section>
        <h2>3. Model training — what we do and don&apos;t do</h2>
        <p>
          <strong>We use data to train and improve our models and systems.</strong> Concretely:
        </p>
        <ul>
          <li>We analyse usage patterns, AI execution outcomes, and anonymised interaction data to improve routing, prompts, and system behaviour.</li>
          <li>Semantic indexes (embeddings) are computed over your content to power search and capability matching within your own tenant.</li>
          <li>Aggregated, de-identified signals may inform platform-wide improvements.</li>
          <li>We do not sell your data, and we do not expose one tenant&apos;s identifiable business content to another tenant through training or otherwise.</li>
          <li>To object to the use of your organisation&apos;s data for improvement purposes, contact <a href={`mailto:${COMPANY.contactEmail}`}>{COMPANY.contactEmail}</a>.</li>
        </ul>
      </section>

      <section>
        <h2>4. Third-party processing</h2>
        <p>
          The Services rely on third-party subprocessors — cloud hosting and database infrastructure (Vercel,
          Supabase) and AI model providers reached through our model-routing layer (which may include OpenRouter
          and the model vendors behind it). Vercel and Supabase each hold their own current <strong>SOC 2 Type II
          certification and GDPR compliance commitments</strong>, per their published trust documentation. Where you bring your own AI provider keys (BYOK), your data is processed by
          your chosen provider under your own agreement with them; we store such keys encrypted and use them only
          to make the calls you configure.
        </p>
      </section>

      <section>
        <h2>5. Our compliance posture</h2>
        <p>
          Our systems are designed and operated in accordance with GDPR principles (lawfulness, purpose
          limitation, data minimisation, security, accountability), enforced through database-level row-level
          security tenant isolation, encrypted storage of API credentials, and per-organisation data isolation.
          We run exclusively on infrastructure (Vercel, Supabase) that holds current SOC 2 Type II certification
          and GDPR commitments — VERIDIAN AI OS itself does not hold an independent SOC 2 certification or
          penetration-test attestation at this time. Every AI execution on the platform is logged with its model,
          token usage, and outcome, giving an auditable ledger of automated processing.
        </p>
      </section>

      <section>
        <h2>6. Retention, export, deletion</h2>
        <p>
          You may export your data during the life of your account. On termination or verified request we delete
          or anonymise your organisation&apos;s data within a reasonable period, except where law requires longer
          retention. Backups age out on rolling schedules.
        </p>
      </section>

      <section>
        <h2>7. Contact</h2>
        <p>
          Data questions, objections, and requests: <a href={`mailto:${COMPANY.contactEmail}`}>{COMPANY.contactEmail}</a>.
        </p>
      </section>
    </LegalShell>
  );
}
