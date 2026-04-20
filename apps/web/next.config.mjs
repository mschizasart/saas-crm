/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['socket.io-client'],
  },
  images: {
    domains: ['localhost'],
  },
  async rewrites() {
    // Only rewrite /api/v1/* to the backend NestJS API.
    // /api/auth/* must stay local — it's NextAuth's own route handler.
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.API_URL || 'http://localhost:3001'}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
