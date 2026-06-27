import { getApiClient } from "../client";

export const webhooksEndpoints = {
  /** GET /api/webhooks — list webhooks for the org */
  list: async () => {
    return getApiClient().get("webhooks").json<{
      success: boolean;
      data: Array<{
        id: string;
        url: string;
        events: string[];
        is_active: boolean;
        created_at: string;
      }>;
    }>();
  },
  /** POST /api/webhooks — create a new webhook */
  create: async (body: { url: string; events: string[] }) => {
    return getApiClient().post("webhooks", { json: body }).json<{
      success: boolean;
      data: { id: string; url: string; events: string[] };
    }>();
  },
  /** DELETE /api/webhooks/:id — delete a webhook */
  delete: async (id: string) => {
    return getApiClient().delete(`webhooks/${id}`).json<{ success: boolean }>();
  },
};