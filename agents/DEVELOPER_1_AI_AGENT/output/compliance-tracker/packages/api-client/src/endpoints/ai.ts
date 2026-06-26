import { getApiClient } from "../client";

export const aiEndpoints = {
  list: (params?: Record<string, string>) => getApiClient().get("ai", { searchParams: params }).json(),
  get: (id: string) => getApiClient().get(`ai/${id}`).json(),
  create: (data: unknown) => getApiClient().post("ai", { json: data }).json(),
  update: (id: string, data: unknown) => getApiClient().put(`ai/${id}`, { json: data }).json(),
  delete: (id: string) => getApiClient().delete(`ai/${id}`).json(),
};
