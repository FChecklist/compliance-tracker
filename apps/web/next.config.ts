import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { typedRoutes: false },
  transpilePackages: ["@compliance/types", "@compliance/db", "@compliance/api-client", "@compliance/config"],
};

export default nextConfig;