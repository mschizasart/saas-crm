import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { Toaster } from '@/components/ui/sonner';
import { PwaRegister } from '@/components/pwa-register';

const inter = { className: 'font-sans' };

export const metadata: Metadata = {
  title: 'AppoinlyCRM',
  description: 'Multi-tenant SaaS CRM Platform',
  manifest: '/manifest.json',
  themeColor: '#3B82F6',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'AppoinlyCRM',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          {children}
          <Toaster richColors position="top-right" />
          <PwaRegister />
        </Providers>
      </body>
    </html>
  );
}
