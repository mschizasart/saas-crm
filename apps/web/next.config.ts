import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['socket.io-client'],
  },
  images: {
    domains: ['localhost'],
  },
  async rewrites() {
    return [
      {
        // Proxy API calls during dev — in production nginx handles this
        source: '/api/:path*',
        destination: `${process.env.API_URL || 'http://localhost:3001'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
