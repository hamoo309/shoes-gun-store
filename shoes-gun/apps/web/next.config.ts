import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() { return [{ source: '/api/:path*', destination: `${process.env.API_URL || 'http://localhost:4000'}/api/:path*` }, { source: '/media/:path*', destination: `${process.env.API_URL || 'http://localhost:4000'}/media/:path*` }, { source: '/uploads/:path*', destination: `${process.env.API_URL || 'http://localhost:4000'}/uploads/:path*` }]; },
  images: { remotePatterns: [{protocol: 'http', hostname:'localhost',port:'4000'}, {protocol:'https',hostname:'images.unsplash.com'}] },
};
export default nextConfig;
