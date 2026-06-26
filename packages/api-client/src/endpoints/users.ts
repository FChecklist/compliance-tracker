import { getApiClient } from "../client";

export const usersEndpoints = {
  list: (params?: Record<string, string>) => getApiClient().get("users", { searchParams: params }).json(),
  get: (id: string) => getApiClient().get(`users/${id}`).json(),
  create: (data: unknown) => getApiClient().post("users", { json: data }).json(),
  update: (id: string, data: unknown) => getApiClient().put(`users/${id}`, { json: data }).json(),
  delete: (id: string) => getApiClient().delete(`users/${id}`).json(),
};