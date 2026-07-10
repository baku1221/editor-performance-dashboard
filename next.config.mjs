/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Enables src/instrumentation.ts (stable without this flag from Next.js 15 on; still needed on 14.x).
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
