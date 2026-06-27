import { getApiClient } from "../client";
export const authEndpoints = {
    sendPasscode: async (email) => {
        return getApiClient().post("auth/passcode", { json: { email } }).json();
    },
    verifyPasscode: async (email, passcode) => {
        return getApiClient().post("auth/passcode/verify", { json: { email, passcode } }).json();
    },
    sendMagicLink: async (email) => {
        return getApiClient().post("auth/magic-link", { json: { email } }).json();
    },
    getSession: async () => {
        return getApiClient().get("auth/session").json();
    },
    logout: async () => {
        return getApiClient().post("auth/logout").json();
    },
};
//# sourceMappingURL=auth.js.map