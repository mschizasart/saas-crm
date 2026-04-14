import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Link from 'next/link';
import { FileText, FolderKanban, Headphones, FileSignature } from 'lucide-react';

const PORTAL_NAV = [
  { label: 'Invoices', href: '/portal/invoices', icon: FileText },
  { label: 'Estimates', href: '/portal/estimates', icon: FileText },
  { label: 'Proposals', href: '/portal/proposals', icon: FileText },
  { label: 'Projects', href: '/portal/projects', icon: FolderKanban },
  { label: 'Support', href: '/portal/tickets', icon: Headphones },
  { label: 'Contracts', href: '/portal/contracts', icon: FileSignature },
];

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Portal Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center">
                <span className="text-white font-bold text-sm">C</span>
              </div>
              <span className="font-semibold text-gray-800">Client Portal</span>
            </div>
            <nav className="hidden md:flex items-center gap-1">
              {PORTAL_NAV.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">{session.user?.email}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>
    </div>
  );
}
