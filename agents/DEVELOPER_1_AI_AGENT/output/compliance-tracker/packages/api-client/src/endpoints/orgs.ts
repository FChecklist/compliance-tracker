import { getApiClient } from "../client";

export const orgsEndpoints = {
  list: (params?: Record<string, string>) => getApiClient().get("orgs", { searchParams: params }).json(),
  get: (id: string) => getApiClient().get(`orgs/${id}`).json(),
  create: (data: unknown) => getApiClient().post("orgs", { json: data }).json(),
  update: (id: string, data: unknown) => getApiClient().put(`orgs/${id}`, { json: data }).json(),
  delete: (id: string) => getApiClient().delete(`orgs/${id}`).json(),
};
