import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { z } from "zod";

/**
 * Google Drive OAuth2 integration for document storage/sync.
 *
 * GET  — check OAuth status / list recent files
 * POST — upload a file to Drive
 */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

const uploadSchema = z.object({
  filename: z.string().min(1),
  mime_type: z.string().min(1),
  base64_data: z.string().min(1),
  folder_id: z.string().optional(),
});

/** Refresh the OAuth access token using the stored refresh token */
async function getValidAccessToken(): Promise<string | null> {
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) return null;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const data = await res.json();
  return data.access_token ?? null;
}

export const GET = withAuth(async () => {
  const hasConfig = process.env.GOOGLE_DRIVE_REFRESH_TOKEN && process.env.GOOGLE_DRIVE_CLIENT_ID;

  if (!hasConfig) {
    return NextResponse.json({
      success: true,
      data: {
        status: "not_configured",
        message: "Set GOOGLE_DRIVE_REFRESH_TOKEN, GOOGLE_DRIVE_CLIENT_ID, and GOOGLE_DRIVE_CLIENT_SECRET env vars.",
        configured: false,
      },
    });
  }

  const token = await getValidAccessToken();
  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: "OAUTH_FAILED", message: "Could not refresh Google OAuth token" } },
      { status: 503 },
    );
  }

  // List the 10 most recently modified files
  const listRes = await fetch(
    `${GOOGLE_DRIVE_API}?pageSize=10&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,size)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const listData = await listRes.json();
  return NextResponse.json({
    success: true,
    data: {
      status: "configured",
      configured: true,
      files: listData.files ?? [],
    },
  });
}, { roles: ["account_admin"] });

export const POST = withAuth(async (req) => {
  const body = uploadSchema.parse(await req.json());
  const token = await getValidAccessToken();

  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: "OAUTH_FAILED", message: "Google OAuth not configured" } },
      { status: 503 },
    );
  }

  const metadata: Record<string, unknown> = {
    name: body.filename,
  };
  if (body.folder_id) {
    metadata.parents = [body.folder_id];
  }

  const buffer = Buffer.from(body.base64_data, "base64");

  const uploadRes = await fetch(
    `${GOOGLE_UPLOAD_API}?uploadType=multipart&fields=id,name,webViewLink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: (() => {
        const boundary = "compliancetrack_boundary";
        const metaPart = JSON.stringify(metadata);
        const multipartBody = [
          `--${boundary}`,
          "Content-Type: application/json; charset=UTF-8",
          "",
          metaPart,
          `--${boundary}`,
          `Content-Type: ${body.mime_type}`,
          "",
          buffer.toString("binary"),
          `--${boundary}--`,
          "",
        ].join("\r\n");
        return Buffer.from(multipartBody, "binary");
      })(),
    },
  );

  const uploadData = await uploadRes.json();

  if (!uploadRes.ok) {
    return NextResponse.json(
      { success: false, error: { code: "UPLOAD_FAILED", message: uploadData.error?.message ?? "Upload failed" } },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      id: uploadData.id,
      name: uploadData.name,
      web_view_link: uploadData.webViewLink,
    },
  });
}, { roles: ["account_admin"] });