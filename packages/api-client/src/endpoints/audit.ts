import { getApiClient } from "../client";

export const auditEndpoints = {
  list: (params?: Record<string, string>) => getApiClient().get("audit", { searchParams: params }).json(),
  get: (id: string) => getApiClient().get(`audit/${id}`).json(),
  create: (data: unknown) => getApiClient().post("audit", { json: data }).json(),
  update: (id: string, data: unknown) => getApiClient().put(`audit/${id}`, { json: data }).json(),
  delete: (id: string) => getApiClient().delete(`audit/${id}`).json(),
};