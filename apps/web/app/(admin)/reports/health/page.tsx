'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  API_BASE,
  authHeaders,
  PageHeader,
  StatCard,
  SkeletonCard,
  ErrorBanner,
} from '../_shared';

interface HealthScore {
  clientId: string;
  company: string;
  score: number;
  grade: string;
}

const GRADE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  excellent: { bg: 'bg-green-100', text: 'text-green-700', label: 'Excellent' },
  good: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Good' },
  at_risk: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'At Risk' },
  critical: { bg: 'bg-red-100', text: 'text-red-700', label: 'Critical' },
};

const ROW_HIGHLIGHT: Record<string, string> = {
  at_risk: 'bg-orange-50/50',
  critical: 'bg-red-50/50',
};

export default function HealthReportPage() {
  const [data, setData] = useState<HealthScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/clients/health-scores`, {
      headers: authHeaders(),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Server responded with ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (Array.isArray(json)) setData(json);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, []);

  const countByGrade = (grade: string) =>
    data.filter((d) => d.grade === grade).length;

  const avgScore =
    data.length > 0
      ? Math.round(data.reduce((sum, d) => sum + d.score, 0) / data.length)
      : 0;

  return (
    <div>
      <PageHeader
        title="Client Health Dashboard"
        description="Overview of all client health scores, sorted by risk level (worst first)."
      />

      {error && <ErrorBanner message={error} />}

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <StatCard label="Total Clients" value={String(data.length)} />
            <StatCard
              label="Average Score"
              value={String(avgScore)}
              accent={
                avgScore >= 80
                  ? 'text-green-600'
                  : avgScore >= 60
                    ? 'text-blue-600'
                    : avgScore >= 40
                      ? 'text-orange-600'
                      : 'text-red-600'
              }
            />
            <StatCard
              label="Critical"
              value={String(countByGrade('critical'))}
              accent="text-red-600"
            />
            <StatCard
              label="At Risk"
              value={String(countByGrade('at_risk'))}
              accent="text-orange-600"
            />
            <StatCard
              label="Healthy"
              value={String(
                countByGrade('excellent') + countByGrade('good'),
              )}
              accent="text-green-600"
            />
          </>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Company
              </th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">
                Score
              </th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">
                Grade
              </th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-100">
                  {Array.from({ length: 4 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div
                        className="h-4 bg-gray-100 rounded animate-pulse"
                        style={{ width: j === 0 ? '60%' : '40%' }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-10 text-center text-sm text-gray-400"
                >
                  No client data available
                </td>
              </tr>
            ) : (
              data.map((client) => {
                const style =
                  GRADE_STYLES[client.grade] ?? GRADE_STYLES.good;
                const highlight = ROW_HIGHLIGHT[client.grade] ?? '';
                return (
                  <tr
                    key={client.clientId}
                    className={`border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors ${highlight}`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <Link
                        href={`/clients/${client.clientId}`}
                        className="hover:text-primary transition-colors"
                      >
                        {client.company}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-semibold text-gray-900">
                        {client.score}
                      </span>
                      <span className="text-gray-400">/100</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${style.bg} ${style.text}`}
                      >
                        {style.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/clients/${client.clientId}`}
                        className="text-xs text-primary hover:underline font-medium"
                      >
                        View Details
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
