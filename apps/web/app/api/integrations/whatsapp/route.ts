import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { z } from "zod";

/**
 * WhatsApp Business Cloud API integration.
 *
 * GET  — fetch integration status / webhook config
 * POST — send a WhatsApp message template
 */

const WHATSAPP_API_URL = "https://graph.facebook.com/v19.0";

const sendSchema = z.object({
  to: z.string().min(10), // phone number with country code
  template_name: z.string().min(1),
  template_language: z.string().default("en_US"),
  parameters: z.array(z.string()).optional(),
});

export const GET = withAuth(async () => {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneId || !accessToken) {
    return NextResponse.json({
      success: true,
      data: {
        status: "not_configured",
        message: "Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN env vars to enable.",
        configured: false,
      },
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      status: "configured",
      phone_number_id: phoneId,
      configured: true,
    },
  });
}, { roles: ["account_admin"] });

export const POST = withAuth(async (req) => {
  const body = sendSchema.parse(await req.json());
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneId) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_CONFIGURED", message: "WhatsApp is not configured" } },
      { status: 503 },
    );
  }

  const templateComponents: unknown[] = [];
  if (body.parameters?.length) {
    templateComponents.push({
      type: "body",
      parameters: body.parameters.map((p) => ({ type: "text", text: p })),
    });
  }

  const res = await fetch(`${WHATSAPP_API_URL}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: body.to,
      type: "template",
      template: {
        name: body.template_name,
        language: { code: body.template_language },
        components: templateComponents,
      },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { success: false, error: { code: "WHATSAPP_API_ERROR", message: data.error?.message ?? "Failed to send" } },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, data: { message_id: data.messages?.[0]?.id } });
}, { roles: ["account_admin"] });