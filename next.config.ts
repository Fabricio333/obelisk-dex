import type { NextConfig } from "next";
import { networkInterfaces } from "os";

// Dynamically collect all local IPs so any device on the network can access dev
const localIPs = Object.values(networkInterfaces())
  .flat()
  .filter((iface) => iface && !iface.internal && iface.family === 'IPv4')
  .map((iface) => iface!.address);

// CSP is now set per-request in src/proxy.ts so it can include a fresh
// per-request nonce. The static security headers below still apply
// site-wide (proxy.ts is HTML-only via its matcher).

const nextConfig: NextConfig = {
  transpilePackages: ['@nostr-wot/ui', '@nostr-wot/data', '@nostr-wot/signers'],
  allowedDevOrigins: [...localIPs, 'obelisk.fabri.lat', 'obelisk.wearebitcoin.org', 'obelisk.nostr-wtf.com', 'dex-test.obelisk.ar', 'obelisk.ar'],
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'dex.obelisk.ar' }],
        destination: 'https://obelisk.ar/:path*',
        permanent: true,
      },
      {
        source: '/chat',
        destination: '/app',
        permanent: true,
      },
      {
        source: '/chat/:path*',
        destination: '/app/:path*',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
