'use client';

/**
 * Reusable, versioned document attachments panel.
 *
 * Renders a "Documents" card for any record (client | invoice | estimate |
 * project | ticket | lead). Supports:
 *   - drag-drop / click to upload (creates v1 of a new document)
 *   - list of documents (name, size, latest version #, uploaded date)
 *   - each row expands to its version history with per-version download +
 *     restore
 *   - delete per document
 *
 * Backed by the /api/v1/documents endpoints. Uploads use a Fastify-
 * compatible multipart POST (FormData with a `file` field, optional
 * `note`). apiFetch attaches the bearer token and does NOT set a
 * Content-Type, so the browser supplies the multipart boundary.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';

export type DocumentEntityType =
  | 'client'
  | 'invoice'
  | 'estimate'
  | 'project'
  | 'ticket'
  | 'lead';

interface DocumentVersion {
  id: string;
  documentId: string;
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string | null;
  note: string | null;
  createdAt: string;
}

interface DocumentRow {
  id: string;
  entityType: string;
  entityId: string;
  name: string;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  versionCount: number;
  currentVersion: DocumentVersion | null;
}

interface VersionHistory {
  documentId: string;
  name: string;
  currentVersionId: string | null;
  versions: DocumentVersion[];
}

interface Props {
  entityType: DocumentEntityType;
  entityId: string;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentPanel({ entityType, entityId }: Props) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, VersionHistory>>({});
  const [busyVersionDoc, setBusyVersionDoc] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const versionInputRef = useRef<HTMLInputElement>(null);
  const versionTargetRef = useRef<string | null>(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/documents/${entityType}/${entityId}`);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setDocs(Array.isArray(json) ? json : json.data ?? []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    if (entityId) fetchDocs();
  }, [fetchDocs, entityId]);

  // ── Upload a new document (v1) ──────────────────────────────

  async function uploadNew(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch(
        `/api/v1/documents/${entityType}/${entityId}`,
        { method: 'POST', body: form },
      );
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg || `Upload failed (${res.status})`);
      }
      toast.success(`Uploaded "${file.name}"`);
      await fetchDocs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadNew(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) uploadNew(file);
  }

  // ── Upload a new version of an existing document ────────────

  function triggerVersionUpload(documentId: string) {
    versionTargetRef.current = documentId;
    versionInputRef.current?.click();
  }

  async function handleVersionInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const documentId = versionTargetRef.current;
    if (versionInputRef.current) versionInputRef.current.value = '';
    if (!file || !documentId) return;
    setBusyVersionDoc(documentId);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch(
        `/api/v1/documents/${documentId}/versions`,
        { method: 'POST', body: form },
      );
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg || `Upload failed (${res.status})`);
      }
      toast.success('New version uploaded');
      await fetchDocs();
      if (expanded === documentId) await loadHistory(documentId, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusyVersionDoc(null);
      versionTargetRef.current = null;
    }
  }

  // ── Version history ─────────────────────────────────────────

  const loadHistory = useCallback(
    async (documentId: string, force = false) => {
      if (history[documentId] && !force) return;
      try {
        const res = await apiFetch(
          `/api/v1/documents/${documentId}/versions`,
        );
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const json: VersionHistory = await res.json();
        setHistory((prev) => ({ ...prev, [documentId]: json }));
      } catch {
        toast.error('Failed to load version history');
      }
    },
    [history],
  );

  function toggleExpand(documentId: string) {
    if (expanded === documentId) {
      setExpanded(null);
      return;
    }
    setExpanded(documentId);
    loadHistory(documentId);
  }

  // ── Download a specific version ─────────────────────────────

  async function download(version: DocumentVersion) {
    try {
      const res = await apiFetch(
        `/api/v1/documents/version/${version.id}/download`,
      );
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = version.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    }
  }

  // ── Restore a version ───────────────────────────────────────

  async function restore(documentId: string, version: DocumentVersion) {
    try {
      const res = await apiFetch(
        `/api/v1/documents/${documentId}/restore/${version.id}`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(`Restore failed (${res.status})`);
      toast.success(`Restored version ${version.version} as current`);
      await fetchDocs();
      await loadHistory(documentId, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed');
    }
  }

  // ── Delete a document ───────────────────────────────────────

  async function remove(doc: DocumentRow) {
    if (!confirm(`Delete "${doc.name}" and all its versions? This cannot be undone.`))
      return;
    try {
      const res = await apiFetch(`/api/v1/documents/${doc.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      toast.success('Document deleted');
      setExpanded((e) => (e === doc.id ? null : e));
      await fetchDocs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Documents {docs.length > 0 && `(${docs.length})`}
        </h2>
        <div>
          <input
            ref={inputRef}
            type="file"
            onChange={handleFileInput}
            className="hidden"
          />
          {/* Hidden input reused for "upload new version" of any row. */}
          <input
            ref={versionInputRef}
            type="file"
            onChange={handleVersionInput}
            className="hidden"
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {uploading ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Uploading…
              </>
            ) : (
              'Upload'
            )}
          </button>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={[
          'mx-4 mt-4 mb-2 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors',
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
        ].join(' ')}
      >
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {dragOver ? 'Drop to upload' : 'Drag & drop a file here, or click to browse'}
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Max 25MB per file</p>
      </div>

      {/* List */}
      {loading ? (
        <div className="p-6 space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-50 dark:bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
          No documents yet
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {docs.map((doc) => {
            const isOpen = expanded === doc.id;
            const cv = doc.currentVersion;
            const hist = history[doc.id];
            return (
              <li key={doc.id}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => toggleExpand(doc.id)}
                    className="flex-1 min-w-0 flex items-center gap-3 text-left"
                  >
                    <svg
                      className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {doc.name}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {formatBytes(cv?.sizeBytes)} · v{cv?.version ?? doc.versionCount} ·{' '}
                        {new Date(cv?.createdAt ?? doc.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </button>
                  <span className="text-[11px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded-full px-2 py-0.5 flex-shrink-0">
                    {doc.versionCount} {doc.versionCount === 1 ? 'version' : 'versions'}
                  </span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {cv && (
                      <button
                        onClick={() => download(cv)}
                        className="text-xs text-primary hover:underline"
                      >
                        Download
                      </button>
                    )}
                    <button
                      onClick={() => triggerVersionUpload(doc.id)}
                      disabled={busyVersionDoc === doc.id}
                      className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50"
                    >
                      {busyVersionDoc === doc.id ? 'Uploading…' : 'New version'}
                    </button>
                    <button
                      onClick={() => remove(doc)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="bg-gray-50/60 dark:bg-gray-800/40 border-t border-gray-100 dark:border-gray-800 px-4 py-3">
                    {!hist ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500 py-2">Loading history…</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="text-left text-gray-400 dark:text-gray-500">
                          <tr>
                            <th className="py-1 pr-2 font-normal">Version</th>
                            <th className="py-1 pr-2 font-normal">File</th>
                            <th className="py-1 pr-2 font-normal">Size</th>
                            <th className="py-1 pr-2 font-normal">Uploaded</th>
                            <th className="py-1 pr-2 font-normal">Note</th>
                            <th className="py-1 font-normal text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hist.versions.map((v) => {
                            const isCurrent = v.id === hist.currentVersionId;
                            return (
                              <tr
                                key={v.id}
                                className="border-t border-gray-100 dark:border-gray-800"
                              >
                                <td className="py-1.5 pr-2">
                                  <span className="inline-flex items-center gap-1 text-gray-700 dark:text-gray-300">
                                    v{v.version}
                                    {isCurrent && (
                                      <span className="px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100 text-[10px]">
                                        current
                                      </span>
                                    )}
                                  </span>
                                </td>
                                <td className="py-1.5 pr-2 text-gray-600 dark:text-gray-400 truncate max-w-[160px]">
                                  {v.fileName}
                                </td>
                                <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400">
                                  {formatBytes(v.sizeBytes)}
                                </td>
                                <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400">
                                  {new Date(v.createdAt).toLocaleString()}
                                </td>
                                <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400 truncate max-w-[140px]">
                                  {v.note ?? '—'}
                                </td>
                                <td className="py-1.5 text-right whitespace-nowrap">
                                  <button
                                    onClick={() => download(v)}
                                    className="text-primary hover:underline"
                                  >
                                    Download
                                  </button>
                                  {!isCurrent && (
                                    <button
                                      onClick={() => restore(doc.id, v)}
                                      className="ml-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                                    >
                                      Restore
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default DocumentPanel;
