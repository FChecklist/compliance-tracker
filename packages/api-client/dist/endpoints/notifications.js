import { getApiClient } from "../client";
export const notificationsEndpoints = {
    list: (params) => getApiClient().get("notifications", { searchParams: params }).json(),
    get: (id) => getApiClient().get(`notifications/${id}`).json(),
    create: (data) => getApiClient().post("notifications", { json: data }).json(),
    update: (id, data) => getApiClient().put(`notifications/${id}`, { json: data }).json(),
    delete: (id) => getApiClient().delete(`notifications/${id}`).json(),
};
//# sourceMappingURL=notifications.js.map