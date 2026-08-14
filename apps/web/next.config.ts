import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(process.cwd(), '../..'),
  transpilePackages: ['@relay-hub/contracts'],
  async rewrites() {
    const apiOrigin = process.env.RELAY_HUB_API_INTERNAL_URL ?? 'http://127.0.0.1:4100';
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
