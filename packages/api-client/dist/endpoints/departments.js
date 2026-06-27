import { getApiClient } from "../client";
export const departmentsEndpoints = {
    list: (params) => getApiClient().get("departments", { searchParams: params }).json(),
    get: (id) => getApiClient().get(`departments/${id}`).json(),
    create: (data) => getApiClient().post("departments", { json: data }).json(),
    update: (id, data) => getApiClient().put(`departments/${id}`, { json: data }).json(),
    delete: (id) => getApiClient().delete(`departments/${id}`).json(),
};
//# sourceMappingURL=departments.js.map