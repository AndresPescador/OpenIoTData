import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ["lucide-react"],
    // The compiler API is deterministic in constrained CI/container runners;
    // type checking is also enforced independently by `npm run typecheck`.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
