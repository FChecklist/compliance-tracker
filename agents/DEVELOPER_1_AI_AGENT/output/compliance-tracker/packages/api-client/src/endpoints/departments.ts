import { getApiClient } from "../client";

export const departmentsEndpoints = {
  list: (params?: Record<string, string>) => getApiClient().get("departments", { searchParams: params }).json(),
  get: (id: string) => getApiClient().get(`departments/${id}`).json(),
  create: (data: unknown) => getApiClient().post("departments", { json: data }).json(),
  update: (id: string, data: unknown) => getApiClient().put(`departments/${id}`, { json: data }).json(),
  delete: (id: string) => getApiClient().delete(`departments/${id}`).json(),
};
