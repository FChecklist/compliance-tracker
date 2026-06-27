import { getApiClient } from "../client";

export const notificationsEndpoints = {
  list: (params?: Record<string, string>) => getApiClient().get("notifications", { searchParams: params }).json(),
  get: (id: string) => getApiClient().get(`notifications/${id}`).json(),
  create: (data: unknown) => getApiClient().post("notifications", { json: data }).json(),
  update: (id: string, data: unknown) => getApiClient().put(`notifications/${id}`, { json: data }).json(),
  delete: (id: string) => getApiClient().delete(`notifications/${id}`).json(),
};
