import type { NextConfig } from 'next';

// Cabeçalhos estáticos. A CSP com nonce é gerada por requisição em proxy.ts.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

// Download de anexos: nunca em cache compartilhado e sem Referer.
const downloadHeaders = [
  { key: 'Cache-Control', value: 'private, no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Até 3 anexos de 10 MB por envio (o limite real da empresa é menor e é conferido no servidor e no banco).
  experimental: { serverActions: { bodySizeLimit: '32mb' } },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/api/anexos/:path*', headers: downloadHeaders },
    ];
  },
};

export default nextConfig;
