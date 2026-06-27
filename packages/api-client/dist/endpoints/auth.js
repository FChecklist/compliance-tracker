import { getApiClient } from "../client";
export const authEndpoints = {
    /** POST /api/auth/register — register a new user */
    register: async (body) => {
        return getApiClient().post("auth/register", { json: body }).json();
    },
    /** POST /api/auth/login — email + password login */
    login: async (body) => {
        return getApiClient().post("auth/login", { json: body }).json();
    },
    /** GET /api/auth/me — get current session user */
    me: async () => {
        return getApiClient().get("auth/me").json();
    },
    /** POST /api/auth/refresh — refresh session token */
    refresh: async () => {
        return getApiClient().post("auth/refresh").json();
    },
    /** POST /api/auth/logout — clear session */
    logout: async () => {
        return getApiClient().post("auth/logout").json();
    },
};
//# sourceMappingURL=auth.js.map