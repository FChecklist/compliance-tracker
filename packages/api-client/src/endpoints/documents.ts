import { getApiClient } from "../client";

export const documentsEndpoints = {
  list: (params?: Record<string, string>) => getApiClient().get("documents", { searchParams: params }).json(),
  get: (id: string) => getApiClient().get(`documents/${id}`).json(),
  create: (data: unknown) => getApiClient().post("documents", { json: data }).json(),
  update: (id: string, data: unknown) => getApiClient().put(`documents/${id}`, { json: data }).json(),
  delete: (id: string) => getApiClient().delete(`documents/${id}`).json(),
};