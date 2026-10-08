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
  // Don't advertise the framework/version.
  poweredByHeader: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "render.worldofwarcraft.com" }],
  },
  // In development the browser calls /api on the web origin; in production Caddy routes /api to the API directly.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/api/:path*` }];
  },
  /**
   * Hardening headers for every page. `frame-ancestors 'none'` blocks clickjacking (no X-Frame-Options so the
   * directive is the single source of truth); the rest stop MIME sniffing and referrer leakage. Scripts and styles
   * allow `'unsafe-inline'` because Next.js injects inline bootstrap scripts and Tailwind inline styles without a
   * nonce here, so a stricter policy would break hydration and styling; the value is the frame/sniff/transport guards.
   */
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https://render.worldofwarcraft.com data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
