/** @type {import('next').NextConfig} */

// In the single-service ("all-in-one") topology, Next.js is the only public
// server: it serves the UI and reverse-proxies the API paths to the in-container
// Fastify process. INTERNAL_API_URL is read at runtime (server side) and, when
// present, turns on those rewrites. In the multi-service topology it is unset,
// the browser calls the API's own domain (baked NEXT_PUBLIC_API_BASE_URL), and
// no rewrites are added.
const internalApi = process.env.INTERNAL_API_URL;

const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are shipped as TypeScript source; let Next compile them.
  transpilePackages: ['@crms/sdk', '@crms/ui'],
  // The web app talks to the API service; expose its base URL to the client.
  // Empty string => same-origin relative calls (the all-in-one default), so the
  // browser hits /v1/... on this same domain and the rewrites below proxy it.
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.API_BASE_URL ?? 'http://localhost:4000',
  },
  ...(internalApi
    ? {
        async rewrites() {
          return [
            { source: '/v1/:path*', destination: `${internalApi}/v1/:path*` },
            { source: '/webhooks/:path*', destination: `${internalApi}/webhooks/:path*` },
            { source: '/health', destination: `${internalApi}/health` },
          ];
        },
      }
    : {}),
};

export default nextConfig;
