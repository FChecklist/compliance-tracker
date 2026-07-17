import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard";
import { createClient } from "@supabase/supabase-js";
import { createId } from "@paralleldrive/cuid2";
import { ORG_BRANDING_BUCKET, resolveBranding, updateBrandingAsset, getBrandingAssetPath } from "@/lib/services/org-branding-service";

// Wave B (VERIDIAN Review Framework remediation, "BYOB white-label
// branding"): logo/favicon upload, following documents/route.ts's own
// established pattern (service-role admin client, org-scoped object path,
// sanitized filename, size limit matching the bucket's own
// file_size_limit) -- the one deliberate divergence is that org-branding is
// a PUBLIC bucket (see drizzle/0221_wave_b_white_label_branding.sql's
// header for why a logo doesn't need documents.ts's private+signed-URL
// treatment), so this route uses getPublicUrl-backed resolution
// (org-branding-service.ts) instead of createSignedUrl.
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // matches the bucket's file_size_limit
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/x-icon"]);
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
};

function getStorageAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  const roleErr = requireRole(dbUser, "admin");
  if (roleErr) return roleErr;
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const kindRaw = formData.get("kind");
    const kind = kindRaw === "favicon" ? "favicon" : "logo";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A file is required" }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "File exceeds 2 MB limit" }, { status: 400 });
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json({ error: "File must be PNG, JPEG, WebP, SVG, or ICO" }, { status: 400 });
    }

    const ext = EXT_BY_MIME[file.type] ?? "bin";
    const objectPath = `${orgId}/${kind}-${createId()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const admin = getStorageAdminClient();
    const { error: uploadError } = await admin.storage.from(ORG_BRANDING_BUCKET).upload(objectPath, bytes, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) {
      console.error("Branding asset upload error:", uploadError);
      return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
    }

    // Best-effort cleanup of the previous asset -- never blocks or fails the
    // response (an orphaned old object is harmless; failing the save because
    // cleanup of the OLD file didn't work would not be).
    const previousPath = await getBrandingAssetPath(orgId, kind);
    if (previousPath) {
      admin.storage.from(ORG_BRANDING_BUCKET).remove([previousPath]).catch((err) =>
        console.error("Branding asset cleanup (previous file) failed:", err)
      );
    }

    const branding = await updateBrandingAsset(orgId, kind, objectPath);
    return NextResponse.json({ branding }, { status: 201 });
  } catch (error) {
    console.error("Branding asset upload error:", error);
    return NextResponse.json({ error: "Failed to upload branding asset" }, { status: 500 });
  }
}

// Removes the org's custom logo/favicon, reverting to the default VERIDIAN
// AI branding for that asset -- exposed in BrandingSection.tsx as "Reset to
// default".
export async function DELETE(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  const roleErr = requireRole(dbUser, "admin");
  if (roleErr) return roleErr;
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind") === "favicon" ? "favicon" : "logo";

    const previousPath = await getBrandingAssetPath(orgId, kind);
    if (previousPath) {
      const admin = getStorageAdminClient();
      admin.storage.from(ORG_BRANDING_BUCKET).remove([previousPath]).catch((err) =>
        console.error("Branding asset cleanup (reset) failed:", err)
      );
    }

    const branding = await updateBrandingAsset(orgId, kind, null);
    return NextResponse.json({ branding });
  } catch (error) {
    console.error("Branding asset reset error:", error);
    return NextResponse.json({ error: "Failed to reset branding asset" }, { status: 500 });
  }
}
