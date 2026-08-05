import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(process.cwd(), '../..'),
  transpilePackages: ['@relay-hub/contracts'],
};

export default nextConfig;
