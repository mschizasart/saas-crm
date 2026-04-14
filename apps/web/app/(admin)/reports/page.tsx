'use client';

import Link from 'next/link';

interface ReportCard {
  href: string;
  title: string;
  description: string;
  icon: string;
  accent: string;
}

const REPORTS: ReportCard[] = [
  {
    href: '/reports/sales',
    title: 'Sales Report',
    description: 'Revenue, paid / outstanding / overdue totals and top clients.',
    icon: 'M3 3v18h18M7 15l4-4 4 4 4-6',
    accent: 'text-blue-600 bg-blue-50',
  },
  {
    href: '/reports/leads',
    title: 'Leads Report',
    description: 'Funnel conversion, sources and assignee performance.',
    icon: 'M12 4v16m8-8H4',
    accent: 'text-violet-600 bg-violet-50',
  },
  {
    href: '/reports/income-expense',
    title: 'Income & Expenses',
    description: 'Income vs expenses trend, category breakdown, net profit.',
    icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8v8m0 0v2',
    accent: 'text-emerald-600 bg-emerald-50',
  },
  {
    href: '/reports/clients',
    title: 'Clients Report',
    description: 'Active, new, churned clients and top accounts by revenue.',
    icon: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m9-5a4 4 0 11-8 0 4 4 0 018 0z',
    accent: 'text-amber-600 bg-amber-50',
  },
  {
    href: '/reports/time-tracking',
    title: 'Time Tracking',
    description: 'Hours logged per user and project, billable breakdown.',
    icon: 'M12 8v4l3 3M12 22a10 10 0 100-20 10 10 0 000 20z',
    accent: 'text-cyan-600 bg-cyan-50',
  },
  {
    href: '/reports/tickets',
    title: 'Support Tickets',
    description: 'Status / priority counts and average resolution time.',
    icon: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4z',
    accent: 'text-rose-600 bg-rose-50',
  },
];

export default function ReportsHubPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-1">
          Analytics across sales, leads, finance, clients, projects and support.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="group bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md hover:border-gray-200 transition-all"
          >
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${r.accent}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={r.icon} />
              </svg>
            </div>
            <h2 className="font-semibold text-gray-900 mb-1 group-hover:text-primary transition-colors">
              {r.title}
            </h2>
            <p className="text-xs text-gray-500 leading-relaxed">
              {r.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
