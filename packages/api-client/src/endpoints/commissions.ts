import { getApiClient } from "../client";

export const commissionsEndpoints = {
  /** GET /api/commissions — list commissions (admin only) */
  list: async (params?: { agent_id?: string }) => {
    const searchParams = params as Record<string, string> | undefined;
    return getApiClient().get("commissions", { searchParams }).json<{
      success: boolean;
      data: Array<{
        id: string;
        agent_id: string;
        amount: number;
        status: string;
        created_at: string;
      }>;
    }>();
  },
};