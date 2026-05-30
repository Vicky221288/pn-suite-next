import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Fail the production build on type or lint errors — CI gate parity (B0.8).
  // RHS shipped with neither; PN does not repeat that.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  reactStrictMode: true,
};

export default nextConfig;
