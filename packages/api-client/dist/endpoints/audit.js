import { getApiClient } from "../client";
export const auditEndpoints = {
    list: (params) => getApiClient().get("audit", { searchParams: params }).json(),
    get: (id) => getApiClient().get(`audit/${id}`).json(),
    create: (data) => getApiClient().post("audit", { json: data }).json(),
    update: (id, data) => getApiClient().put(`audit/${id}`, { json: data }).json(),
    delete: (id) => getApiClient().delete(`audit/${id}`).json(),
};
//# sourceMappingURL=audit.js.map