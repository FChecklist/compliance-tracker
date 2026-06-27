import { getApiClient } from "../client";

export const complianceStatsEndpoints = {
  /** GET /api/compliance/stats — dashboard stats for the org */
  get: async () => {
    return getApiClient().get("compliance/stats").json<{
      success: boolean;
      data: {
        total: number;
        by_status: Record<string, number>;
        by_priority: Record<string, number>;
        overdue_count: number;
        upcoming_deadlines: Array<{ id: string; title: string; due_date: string; priority: string }>;
      };
    }>();
  },
};

export const complianceExportEndpoints = {
  /** GET /api/compliance/export?format=csv|excel|pdf — download compliance data */
  download: async (format: "csv" | "excel" | "pdf", filters?: Record<string, string>) => {
    const client = getApiClient();
    const searchParams = { format, ...filters };
    return client.get("compliance/export", { searchParams }).blob();
  },
};