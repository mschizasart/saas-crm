'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Building2, ShieldCheck, LogOut, Package, CreditCard } from 'lucide-react';

interface PlatformAdmin {
  id: string;
  email: string;
  name: string;
}

const NAV = [
  { href: '/platform', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/platform/organizations', label: 'Organizations', icon: Building2 },
  { href: '/platform/plans', label: 'Plans', icon: Package },
  { href: '/platform/billing', label: 'Billing', icon: CreditCard },
  { href: '/platform/admins', label: 'Admins', icon: ShieldCheck },
];

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [ready, setReady] = useState(false);

  const isLogin = pathname === '/platform/login';

  useEffect(() => {
    if (isLogin) {
      setReady(true);
      return;
    }
    const token = localStorage.getItem('platform_token');
    if (!token) {
      router.replace('/platform/login');
      return;
    }
    const raw = localStorage.getItem('platform_admin');
    if (raw) {
      try {
        setAdmin(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    }
    setReady(true);
  }, [isLogin, router]);

  const logout = () => {
    localStorage.removeItem('platform_token');
    localStorage.removeItem('platform_admin');
    router.replace('/platform/login');
  };

  if (!ready) {
    return <div className="min-h-screen bg-gray-50" />;
  }

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-slate-900 text-slate-100 flex flex-col h-screen overflow-y-auto">
        <div className="flex items-center gap-2 px-4 py-5 border-b border-slate-800">
          <div className="w-7 h-7 bg-indigo-500 rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-sm">P</span>
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">Platform Admin</div>
            <div className="text-[10px] text-slate-400">Super User</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-indigo-500 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-4">
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="h-14 bg-white border-b border-gray-100 px-6 flex items-center justify-between flex-shrink-0">
          <h1 className="text-sm font-semibold text-gray-900">Platform Admin</h1>
          <div className="flex items-center gap-3">
            {admin && (
              <>
                <div className="text-right">
                  <div className="text-xs font-medium text-gray-900">{admin.name}</div>
                  <div className="text-[10px] text-gray-500">{admin.email}</div>
                </div>
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold">
                  {admin.name?.slice(0, 2).toUpperCase() || 'PA'}
                </div>
              </>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
