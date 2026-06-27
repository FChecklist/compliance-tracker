import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: false,
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ["@compliancetrack/types", "@compliancetrack/db", "@compliancetrack/api-client", "@compliancetrack/config"],
};

export default nextConfig;