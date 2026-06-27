import { use } from "react";
import { notFound, redirect } from "next/navigation";

/**
 * Public compliance slug route.
 * Used for shareable unique URLs like /compliance/abc-123.
 * Lives outside (app) group so it renders without the app shell.
 * Fetches the compliance item by slug and redirects to the authenticated detail page.
 */
export default async function ComplianceSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Try to fetch by slug filter — the API supports ?slug=xxx
  const apiUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const res = await fetch(`${apiUrl}/api/compliance?slug=${encodeURIComponent(slug)}&per_page=1`, {
    cache: "no-store",
  });

  if (!res.ok) return notFound();

  const json = await res.json();

  // API returns data as array — find matching slug
  const items: Array<{ id: string; unique_url_slug: string }> = json.data ?? [];
  const item = items.find((i) => i.unique_url_slug === slug);

  if (!item) return notFound();

  // Redirect to the authenticated detail page within the app shell
  redirect(`/compliance/${item.id}`);
}