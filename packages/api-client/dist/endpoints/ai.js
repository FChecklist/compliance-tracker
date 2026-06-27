import { getApiClient } from "../client";
export const aiEndpoints = {
    list: (params) => getApiClient().get("ai", { searchParams: params }).json(),
    get: (id) => getApiClient().get(`ai/${id}`).json(),
    create: (data) => getApiClient().post("ai", { json: data }).json(),
    update: (id, data) => getApiClient().put(`ai/${id}`, { json: data }).json(),
    delete: (id) => getApiClient().delete(`ai/${id}`).json(),
};
//# sourceMappingURL=ai.js.map