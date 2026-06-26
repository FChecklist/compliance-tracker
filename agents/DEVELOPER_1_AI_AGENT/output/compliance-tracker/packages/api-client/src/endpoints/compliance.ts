import { getApiClient } from "../client";
import type { PaginatedResponse, ApiResponse } from "@compliancetrack/types";
import type { CreateComplianceSchema, UpdateComplianceSchema, ChangeStatusSchema, ReassignSchema, BulkStatusChangeSchema, ComplianceFiltersSchema } from "@compliancetrack/types";
import { z } from "zod";

export const complianceEndpoints = {
  list: async (filters: z.infer<typeof ComplianceFiltersSchema>) => {
    const client = getApiClient();
    return client.get("compliance", { searchParams: filters as Record<string, string> }).json<PaginatedResponse<unknown>>();
  },
  get: async (id: string) => {
    return getApiClient().get(`compliance/${id}`).json<ApiResponse<unknown>>();
  },
  create: async (data: z.infer<typeof CreateComplianceSchema>) => {
    return getApiClient().post("compliance", { json: data }).json<ApiResponse<unknown>>();
  },
  update: async (id: string, data: z.infer<typeof UpdateComplianceSchema>) => {
    return getApiClient().put(`compliance/${id}`, { json: data }).json<ApiResponse<unknown>>();
  },
  delete: async (id: string) => {
    return getApiClient().delete(`compliance/${id}`).json<ApiResponse<null>>();
  },
  changeStatus: async (id: string, data: z.infer<typeof ChangeStatusSchema>) => {
    return getApiClient().put(`compliance/${id}/status`, { json: data }).json<ApiResponse<unknown>>();
  },
  reassign: async (id: string, data: z.infer<typeof ReassignSchema>) => {
    return getApiClient().put(`compliance/${id}/reassign`, { json: data }).json<ApiResponse<unknown>>();
  },
  bulkStatusChange: async (data: z.infer<typeof BulkStatusChangeSchema>) => {
    return getApiClient().post("compliance/bulk", { json: data }).json<ApiResponse<unknown>>();
  },
};
