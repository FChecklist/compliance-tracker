import ky, { type KyInstance, type BeforeRequestHook } from "ky";

let apiClient: KyInstance;

export function getApiClient(): KyInstance {
  if (!apiClient) {
    const authHook: BeforeRequestHook = (request) => {
      const token = typeof window !== "undefined"
        ? document.cookie
            .split("; ")
            .find((c) => c.startsWith("auth-token="))
            ?.split("=")[1]
        : null;
      if (token) {
        request.headers.set("Authorization", `Bearer ${token}`);
      }
    };

    apiClient = ky.create({
      prefixUrl: process.env.NEXT_PUBLIC_API_URL || "/api",
      hooks: { beforeRequest: [authHook] },
      timeout: 30000,
      retry: { limit: 2 },
    });
  }
  return apiClient;
}

export function createServerClient(token: string): KyInstance {
  return ky.create({
    prefixUrl: process.env.API_URL || "http://localhost:3000/api",
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000,
  });
}
