import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const monorepoRoot = path.join(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  transpilePackages: ["@wow/config"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "render.worldofwarcraft.com" }],
  },
  // In development the browser calls /api on the web origin; in production Caddy routes /api to the API directly.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/api/:path*` }];
  },
};

export default withNextIntl(nextConfig);
