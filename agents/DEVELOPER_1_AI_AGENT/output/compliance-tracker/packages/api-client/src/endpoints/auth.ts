import { getApiClient } from "../client";

export const authEndpoints = {
  sendPasscode: async (email: string) => {
    return getApiClient().post("auth/passcode", { json: { email } }).json<{ success: boolean }>();
  },
  verifyPasscode: async (email: string, passcode: string) => {
    return getApiClient().post("auth/passcode/verify", { json: { email, passcode } }).json<{ success: boolean; token: string }>();
  },
  sendMagicLink: async (email: string) => {
    return getApiClient().post("auth/magic-link", { json: { email } }).json<{ success: boolean }>();
  },
  getSession: async () => {
    return getApiClient().get("auth/session").json<{ success: boolean; data: unknown }>();
  },
  logout: async () => {
    return getApiClient().post("auth/logout").json<{ success: boolean }>();
  },
};
