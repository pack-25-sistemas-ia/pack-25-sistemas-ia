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

// Página e arquivos do link do cliente: o token é uma credencial → nunca em Referer, nunca em cache, nunca indexado.
const trackingHeaders = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cache-Control', value: 'private, no-store' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

// Download de arquivos e PDFs: nunca em cache compartilhado e sem Referer.
const downloadHeaders = [
  { key: 'Cache-Control', value: 'private, no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // O gerador de PDF roda só no Node, fora do bundle.
  serverExternalPackages: ['@react-pdf/renderer'],
  // Até 5 arquivos de 10 MB por envio (o limite real da empresa é menor e é conferido no servidor e no banco).
  experimental: { serverActions: { bodySizeLimit: '60mb' }, proxyClientMaxBodySize: '60mb' },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/acompanhar/:path*', headers: trackingHeaders },
      { source: '/api/arquivos/:path*', headers: downloadHeaders },
      { source: '/api/pdf/:path*', headers: downloadHeaders },
    ];
  },
};

export default nextConfig;
