import { getApiClient } from "../client";

export const tokensEndpoints = {
  /** GET /api/tokens — list API tokens for the org */
  list: async () => {
    return getApiClient().get("tokens").json<{
      success: boolean;
      data: Array<{
        id: string;
        name: string;
        prefix: string;
        created_at: string;
        last_used_at: string | null;
      }>;
    }>();
  },
  /** POST /api/tokens — create a new API token */
  create: async (body: { name: string }) => {
    return getApiClient().post("tokens", { json: body }).json<{
      success: boolean;
      data: { id: string; token: string; name: string };
    }>();
  },
  /** DELETE /api/tokens/:id — revoke an API token */
  revoke: async (id: string) => {
    return getApiClient().delete(`tokens/${id}`).json<{ success: boolean }>();
  },
};