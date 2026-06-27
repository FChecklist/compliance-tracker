import { getApiClient } from "../client";

export const authEndpoints = {
  /** POST /api/auth/register — register a new user */
  register: async (body: { email: string; password: string; name: string; org_name: string }) => {
    return getApiClient().post("auth/register", { json: body }).json<{ success: boolean; data: { user: { id: string; email: string } } }>();
  },
  /** POST /api/auth/login — email + password login */
  login: async (body: { email: string; password: string }) => {
    return getApiClient().post("auth/login", { json: body }).json<{ success: boolean; data: { token: string; user: { id: string; email: string; role: string } } }>();
  },
  /** GET /api/auth/me — get current session user */
  me: async () => {
    return getApiClient().get("auth/me").json<{ success: boolean; data: { id: string; email: string; role: string; org_id: string } }>();
  },
  /** POST /api/auth/refresh — refresh session token */
  refresh: async () => {
    return getApiClient().post("auth/refresh").json<{ success: boolean; data: { token: string } }>();
  },
  /** POST /api/auth/logout — clear session */
  logout: async () => {
    return getApiClient().post("auth/logout").json<{ success: boolean }>();
  },
};