/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The web app talks to the API service; expose its base URL to the client.
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.API_BASE_URL ?? 'http://localhost:4000',
  },
};

export default nextConfig;
