import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // self-contained server bundle (.next/standalone) for Node hosts; Vercel ignores it
  output: 'standalone',
  // the street-data snapshot is read from disk by the API route
  outputFileTracingIncludes: { '/api/streets': ['./data/**/*'] },
};

export default nextConfig;
