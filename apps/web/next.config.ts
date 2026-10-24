import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        // Compatible baseline: protect framing, forms and plugins without
        // allowing unsafe-inline or breaking Next's hydration scripts.
        { key: 'Content-Security-Policy', value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'" },
      ] },
      { source: '/admin/:path*', headers: [
        { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      ] },
    ];
  },
  async rewrites() { return [{ source: '/api/:path*', destination: `${process.env.API_URL || 'http://localhost:4000'}/api/:path*` }, { source: '/media/:path*', destination: `${process.env.API_URL || 'http://localhost:4000'}/media/:path*` }, { source: '/uploads/:path*', destination: `${process.env.API_URL || 'http://localhost:4000'}/uploads/:path*` }]; },
  images: { remotePatterns: [{protocol: 'http', hostname:'localhost',port:'4000'}, {protocol:'https',hostname:'images.unsplash.com'}] },
};
export default nextConfig;
