import { getApiClient } from "../client";
export const agentsEndpoints = {
    list: (params) => getApiClient().get("agents", { searchParams: params }).json(),
    get: (id) => getApiClient().get(`agents/${id}`).json(),
    create: (data) => getApiClient().post("agents", { json: data }).json(),
    update: (id, data) => getApiClient().put(`agents/${id}`, { json: data }).json(),
    delete: (id) => getApiClient().delete(`agents/${id}`).json(),
};
//# sourceMappingURL=agents.js.map