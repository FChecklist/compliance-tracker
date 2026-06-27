import { getApiClient } from "../client";
export const orgsEndpoints = {
    list: (params) => getApiClient().get("orgs", { searchParams: params }).json(),
    get: (id) => getApiClient().get(`orgs/${id}`).json(),
    create: (data) => getApiClient().post("orgs", { json: data }).json(),
    update: (id, data) => getApiClient().put(`orgs/${id}`, { json: data }).json(),
    delete: (id) => getApiClient().delete(`orgs/${id}`).json(),
};
//# sourceMappingURL=orgs.js.map