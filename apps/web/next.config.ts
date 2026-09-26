import type { NextConfig } from 'next';
const config: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  transpilePackages: ['@vianoor/ui'],
  poweredByHeader: false,
  reactStrictMode: true,
};
export default config;
