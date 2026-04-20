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
    // Only /api/v1/* is the backend NestJS API. /api/auth/* belongs to NextAuth.
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.API_URL || 'http://localhost:3001'}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
