import { getApiClient } from "../client";
export const usersEndpoints = {
    list: (params) => getApiClient().get("users", { searchParams: params }).json(),
    get: (id) => getApiClient().get(`users/${id}`).json(),
    create: (data) => getApiClient().post("users", { json: data }).json(),
    update: (id, data) => getApiClient().put(`users/${id}`, { json: data }).json(),
    delete: (id) => getApiClient().delete(`users/${id}`).json(),
};
//# sourceMappingURL=users.js.map