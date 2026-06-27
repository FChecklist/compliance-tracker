import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { typedRoutes: false },
  transpilePackages: ["@compliancetrack/types", "@compliancetrack/db", "@compliancetrack/api-client", "@compliancetrack/config"],
};

export default nextConfig;