'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export default function LeadsImportPage() {
  const [csvContent, setCsvContent] = useState<string>('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[][]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setResult(null);
    setError(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvContent(text);

      const lines = text.split('\n').filter((l) => l.trim().length > 0);
      const previewRows = lines.slice(0, 6).map((line) =>
        line.split(',').map((cell) => cell.replace(/^"|"$/g, '').trim()),
      );
      setPreview(previewRows);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!csvContent) return;
    setImporting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/v1/imports/leads`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ csv: csvContent }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data: ImportResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
        <Link href="/leads" className="hover:text-primary transition-colors">Leads</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Import CSV</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Import Leads from CSV</h1>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
        <p className="text-sm text-gray-600 mb-4">
          Upload a CSV file with these columns: <strong>name</strong> (required), email, phone, company, position, source, status.
          The first row should be the header.
        </p>

        <div className="flex items-center gap-3 mb-4">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 text-sm font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Choose CSV File
          </button>
          {fileName && <span className="text-sm text-gray-600">{fileName}</span>}
        </div>

        {preview.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Preview (first 5 rows)</h3>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    {preview[0]?.map((header, i) => (
                      <th key={i} className="px-3 py-2 text-left font-semibold text-gray-600">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(1).map((row, ri) => (
                    <tr key={ri} className="border-t border-gray-100">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-2 text-gray-700">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <button
          onClick={handleImport}
          disabled={importing || !csvContent}
          className="px-5 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {importing ? 'Importing...' : 'Import'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 mb-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {result && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Import Results</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-700">{result.imported}</p>
              <p className="text-xs text-green-600">Imported</p>
            </div>
            <div className="text-center p-3 bg-yellow-50 rounded-lg">
              <p className="text-2xl font-bold text-yellow-700">{result.skipped}</p>
              <p className="text-xs text-yellow-600">Skipped</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-700">{result.errors.length}</p>
              <p className="text-xs text-gray-600">Errors</p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-gray-500 mb-2">Error Details:</p>
              <ul className="text-xs text-red-600 space-y-1 max-h-40 overflow-y-auto">
                {result.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
