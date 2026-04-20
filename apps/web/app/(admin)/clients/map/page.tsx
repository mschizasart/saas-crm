'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

interface ClientData {
  id: string;
  company: string;
  country?: string | null;
  city?: string | null;
  state?: string | null;
}

interface CountryGroup {
  country: string;
  count: number;
  cities: {
    city: string;
    clients: ClientData[];
  }[];
}

export default function ClientMapPage() {
  const [clients, setClients] = useState<ClientData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/clients?limit=500`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const json = await res.json();
        setClients(json.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load clients');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    const filtered = search
      ? clients.filter(
          (c) =>
            (c.country ?? '').toLowerCase().includes(search.toLowerCase()) ||
            (c.city ?? '').toLowerCase().includes(search.toLowerCase()) ||
            c.company.toLowerCase().includes(search.toLowerCase()),
        )
      : clients;

    const countryMap = new Map<string, Map<string, ClientData[]>>();

    for (const client of filtered) {
      const country = client.country?.trim() || 'Unknown';
      const city = client.city?.trim() || 'Unknown';

      if (!countryMap.has(country)) countryMap.set(country, new Map());
      const cityMap = countryMap.get(country)!;
      if (!cityMap.has(city)) cityMap.set(city, []);
      cityMap.get(city)!.push(client);
    }

    const result: CountryGroup[] = [];
    for (const [country, cityMap] of countryMap) {
      const cities: CountryGroup['cities'] = [];
      let totalCount = 0;
      for (const [city, cityClients] of cityMap) {
        cities.push({ city, clients: cityClients });
        totalCount += cityClients.length;
      }
      cities.sort((a, b) => b.clients.length - a.clients.length);
      result.push({ country, count: totalCount, cities });
    }

    result.sort((a, b) => b.count - a.count);
    return result;
  }, [clients, search]);

  function toggleCountry(country: string) {
    setExpandedCountries((prev) => {
      const next = new Set(prev);
      if (next.has(country)) next.delete(country);
      else next.add(country);
      return next;
    });
  }

  if (loading) return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading clients...</div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Client Map</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Clients grouped by geographic location</p>
        </div>
        <Link href="/clients" className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary">
          &larr; Back to clients
        </Link>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-sm text-red-600 rounded">{error}</div>
      )}

      <div className="mb-4">
        <div className="relative max-w-sm">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="Filter by country, city, or company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white dark:bg-gray-900"
          />
        </div>
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        {clients.length} client{clients.length !== 1 ? 's' : ''} across {grouped.length} countr{grouped.length !== 1 ? 'ies' : 'y'}
      </div>

      {grouped.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-8 text-center text-sm text-gray-400 dark:text-gray-500">
          {search ? `No clients match "${search}"` : 'No clients with address data found'}
        </div>
      ) : (
        <div className="space-y-2">
          {grouped.map((group) => {
            const isExpanded = expandedCountries.has(group.country);
            return (
              <div key={group.country} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
                <button
                  onClick={() => toggleCountry(group.country)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{group.country}</span>
                  </div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                    {group.count} client{group.count !== 1 ? 's' : ''}
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3">
                    {group.cities.map((cityGroup) => (
                      <div key={cityGroup.city} className="mb-3 last:mb-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{cityGroup.city}</span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">({cityGroup.clients.length})</span>
                        </div>
                        <div className="pl-4 space-y-1">
                          {cityGroup.clients.map((client) => (
                            <Link
                              key={client.id}
                              href={`/clients/${client.id}`}
                              className="block text-sm text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
                            >
                              {client.company}
                            </Link>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
