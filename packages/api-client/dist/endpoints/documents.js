import { getApiClient } from "../client";
export const documentsEndpoints = {
    list: (params) => getApiClient().get("documents", { searchParams: params }).json(),
    get: (id) => getApiClient().get(`documents/${id}`).json(),
    create: (data) => getApiClient().post("documents", { json: data }).json(),
    update: (id, data) => getApiClient().put(`documents/${id}`, { json: data }).json(),
    delete: (id) => getApiClient().delete(`documents/${id}`).json(),
};
//# sourceMappingURL=documents.js.map