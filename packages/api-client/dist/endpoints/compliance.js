import { getApiClient } from "../client";
export const complianceEndpoints = {
    list: async (filters) => {
        const client = getApiClient();
        return client.get("compliance", { searchParams: filters }).json();
    },
    get: async (id) => {
        return getApiClient().get(`compliance/${id}`).json();
    },
    create: async (data) => {
        return getApiClient().post("compliance", { json: data }).json();
    },
    update: async (id, data) => {
        return getApiClient().put(`compliance/${id}`, { json: data }).json();
    },
    delete: async (id) => {
        return getApiClient().delete(`compliance/${id}`).json();
    },
    changeStatus: async (id, data) => {
        return getApiClient().put(`compliance/${id}/status`, { json: data }).json();
    },
    reassign: async (id, data) => {
        return getApiClient().put(`compliance/${id}/reassign`, { json: data }).json();
    },
    bulkStatusChange: async (data) => {
        return getApiClient().post("compliance/bulk", { json: data }).json();
    },
};
//# sourceMappingURL=compliance.js.map