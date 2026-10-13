import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: ['pdfkit', 'svg-to-pdfkit'],
  outputFileTracingIncludes: {
    '/api/template-editor/export/pdf': ['./app/fonts/**/*', './app/admin/**/typefaces/google/**/*', './public/fonts/licensed/**/*', './public/template-editor/**/*', './node_modules/geist/dist/fonts/geist-sans/**/*'],
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
