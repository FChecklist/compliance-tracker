import { getApiClient } from "../client";

export const agentsEndpoints = {
  list: (params?: Record<string, string>) => getApiClient().get("agents", { searchParams: params }).json(),
  get: (id: string) => getApiClient().get(`agents/${id}`).json(),
  create: (data: unknown) => getApiClient().post("agents", { json: data }).json(),
  update: (id: string, data: unknown) => getApiClient().put(`agents/${id}`, { json: data }).json(),
  delete: (id: string) => getApiClient().delete(`agents/${id}`).json(),
};
