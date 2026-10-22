import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: ['pdfkit', 'svg-to-pdfkit', 'yjs'],
  outputFileTracingExcludes: {
    '/*': ['./.engine-dev/**/*', './outputs/**/*', './.env*'],
  },
  outputFileTracingIncludes: {
    '/api/agent/bridge': ['./scripts/engine-agent-mcp.mjs'],
    '/api/template-editor/export/pdf': ['./assets/pdf-fonts/*.ttf', './public/fonts/licensed/**/*', './public/template-editor/**/*', './node_modules/geist/dist/fonts/geist-sans/**/*'],
  },
  redirects() {
    return [
      {
        source: "/admin/grateful-future/:path*",
        destination: "/admin/engine/:path*",
        permanent: true,
      },
      {
        source: "/grateful-future/:path*",
        destination: "/engine/:path*",
        permanent: true,
      },
    ];
  },
  rewrites() {
    return [
      {
        source: "/api/grateful-future/:path*",
        destination: "/api/engine/:path*",
      },
    ];
  },
};

export default nextConfig;
