import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  // The design system ships as workspace source, so Next compiles it with the app.
  transpilePackages: ['@tamkeen/ui'],
  async rewrites() { return [{ source: '/api/v1/:path*', destination: `${process.env.API_BASE_URL ?? 'http://127.0.0.1:4000'}/api/v1/:path*` }]; }
};
export default config;
