'use client';

import { useEffect, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  API_BASE,
  authHeaders,
  formatCurrency,
  StatCard,
  SkeletonCard,
  ErrorBanner,
  PageHeader,
  ExportMenu,
  PIE_PALETTE,
} from '../_shared';

interface ClientsReport {
  totalClients: number;
  activeClients: number;
  newThisMonth: number;
  byCountry: Array<{ country: string; count: number }>;
  topByRevenue: Array<{
    clientId: string;
    company: string;
    totalRevenue: number;
  }>;
  churnedClients: number;
}

export default function ClientsReportPage() {
  const [data, setData] = useState<ClientsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/v1/reports/clients`, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load report');
        return res.json();
      })
      .then((json: ClientsReport) => alive && setData(json))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <PageHeader
        title="Clients Report"
        description="Customer base breakdown, distribution and top revenue accounts."
        right={<ExportMenu resource="clients" />}
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading || !data ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <StatCard
              label="Total Clients"
              value={String(data.totalClients)}
              accent="text-blue-600"
            />
            <StatCard
              label="Active"
              value={String(data.activeClients)}
              accent="text-green-600"
            />
            <StatCard
              label="New This Month"
              value={String(data.newThisMonth)}
              accent="text-violet-600"
            />
            <StatCard
              label="Churned (90d)"
              value={String(data.churnedClients)}
              accent="text-red-600"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Clients by Country</h2>
          <div style={{ width: '100%', height: 340 }}>
            {loading || !data ? (
              <div className="h-full bg-gray-50 rounded animate-pulse" />
            ) : data.byCountry.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">
                No country data.
              </p>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={data.byCountry}
                    dataKey="count"
                    nameKey="country"
                    outerRadius={120}
                    label
                  >
                    {data.byCountry.map((_, i) => (
                      <Cell
                        key={i}
                        fill={PIE_PALETTE[i % PIE_PALETTE.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Top 10 by Revenue</h2>
          {loading || !data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-8 bg-gray-50 rounded animate-pulse" />
              ))}
            </div>
          ) : data.topByRevenue.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              No revenue data.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-400 uppercase border-b border-gray-100">
                  <th className="py-2">Client</th>
                  <th className="py-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.topByRevenue.map((c) => (
                  <tr
                    key={c.clientId}
                    className="border-b border-gray-100 last:border-0"
                  >
                    <td className="py-2 text-gray-800 truncate max-w-[200px]">
                      {c.company}
                    </td>
                    <td className="py-2 text-right font-semibold text-gray-900">
                      {formatCurrency(c.totalRevenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
