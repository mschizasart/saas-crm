'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const NAV = [
  { label: 'Dashboard', href: '/portal/dashboard' },
  { label: 'Invoices', href: '/portal/invoices' },
  { label: 'Projects', href: '/portal/projects' },
  { label: 'Tickets', href: '/portal/tickets' },
  { label: 'Knowledge Base', href: '/portal/knowledge-base' },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // Unauthenticated auth pages have no shell (centered card, like login)
  const isAuthPage =
    pathname === '/portal/login' ||
    pathname === '/portal/forgot-password' ||
    pathname === '/portal/register' ||
    pathname?.startsWith('/portal/reset-password/');
  if (isAuthPage) {
    return <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">{children}</div>;
  }

  // Public pages (no auth required) render without portal shell
  const isPublic =
    pathname?.startsWith('/portal/contracts/sign/') ||
    pathname?.startsWith('/portal/proposals/view/');
  if (isPublic) {
    return <>{children}</>;
  }

  function signOut() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      router.push('/portal/login');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">C</span>
              </div>
              <span className="font-semibold text-gray-800 dark:text-gray-200">Client Portal</span>
            </div>
            <nav className="hidden md:flex items-center gap-1">
              {NAV.map((item) => {
                const active = pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                      active ? 'bg-primary/10 text-primary font-medium' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <button
                onClick={signOut}
                className="ml-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              >
                Sign Out
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">{children}</main>
    </div>
  );
}
