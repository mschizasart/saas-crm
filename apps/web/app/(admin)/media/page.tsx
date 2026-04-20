'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { FilePreviewModal } from '../../../components/file-preview-modal';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form-field';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface MediaFile {
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: string | null;
  url: string;
}

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileIcon(type: string): string {
  if (type.startsWith('image/')) return '🖼️';
  if (type === 'application/pdf') return '📄';
  if (type.includes('word')) return '📝';
  if (type.includes('sheet') || type.includes('excel')) return '📊';
  if (type === 'text/csv') return '📊';
  if (type.startsWith('text/')) return '📃';
  if (type.includes('zip')) return '🗜️';
  return '📎';
}

export default function MediaPage() {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [folder, setFolder] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<MediaFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/storage/files?folder=${encodeURIComponent(folder)}`,
        { headers: authHeaders() },
      );
      if (res.ok) {
        const data = await res.json();
        setFiles(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  }, [folder, authHeaders]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const uploadFiles = async (fileList: FileList | File[]) => {
    const list = Array.from(fileList);
    for (const file of list) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('folder', folder);
      await fetch(`${API_BASE}/api/v1/storage/upload`, {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      });
    }
    await loadFiles();
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) uploadFiles(e.target.files);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  const deleteFile = async (f: MediaFile) => {
    if (!confirm(`Delete "${f.name}"?`)) return;
    await fetch(`${API_BASE}/api/v1/storage/files`, {
      method: 'DELETE',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: f.path }),
    });
    await loadFiles();
  };

  const copyUrl = async (f: MediaFile) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/storage/url?path=${encodeURIComponent(f.path)}`,
        { headers: authHeaders() },
      );
      const data = await res.json();
      await navigator.clipboard.writeText(data.url || f.url);
      alert('URL copied to clipboard');
    } catch {
      await navigator.clipboard.writeText(f.url);
      alert('URL copied to clipboard');
    }
  };

  const createFolder = async () => {
    const name = prompt('New folder name:');
    if (!name) return;
    const cleaned = name.replace(/[^\w.\-]+/g, '_');
    const target = folder ? `${folder}/${cleaned}` : cleaned;
    const fd = new FormData();
    fd.append('file', new Blob([''], { type: 'text/plain' }), '.keep');
    fd.append('folder', target);
    await fetch(`${API_BASE}/api/v1/storage/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    });
    setFolder(target);
  };

  const openFile = (f: MediaFile) => {
    setPreview(f);
  };

  const breadcrumbs = folder ? folder.split('/') : [];
  const filtered = files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6">
      <PageHeader
        title="Media Manager"
        primaryAction={{ label: 'Upload', onClick: () => fileInputRef.current?.click() }}
        secondaryActions={[{ label: 'New Folder', onClick: createFolder }]}
      />
      <input
        ref={fileInputRef}
        aria-label="Upload files"
        type="file"
        multiple
        className="hidden"
        onChange={onFileInputChange}
      />

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 mb-4 text-sm">
        <button
          onClick={() => setFolder('')}
          className="text-primary hover:underline"
        >
          root
        </button>
        {breadcrumbs.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-gray-400 dark:text-gray-500">/</span>
            <button
              onClick={() =>
                setFolder(breadcrumbs.slice(0, i + 1).join('/'))
              }
              className="text-primary hover:underline"
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {/* Search */}
      <input
        aria-label="Search files"
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search files..."
        className={`${inputClass} max-w-sm mb-4`}
      />

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-4 min-h-[400px] ${
          dragging ? 'border-primary bg-primary/5' : 'border-gray-300'
        }`}
      >
        {loading ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-12">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-12">
            No files. Drop files here or click Upload.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {filtered.map((f) => (
              <div
                key={f.path}
                className="border rounded-lg p-3 bg-white dark:bg-gray-900 hover:shadow-md transition"
              >
                <div
                  onClick={() => openFile(f)}
                  className="cursor-pointer text-center"
                >
                  {f.type.startsWith('image/') ? (
                    <img
                      src={f.url}
                      alt={f.name}
                      className="w-full h-24 object-cover rounded mb-2"
                    />
                  ) : (
                    <div className="text-5xl mb-2">{fileIcon(f.type)}</div>
                  )}
                  <div
                    className="text-sm font-medium truncate"
                    title={f.name}
                  >
                    {f.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {formatSize(f.size)}
                  </div>
                  {f.lastModified && (
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      {new Date(f.lastModified).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 mt-2">
                  <Button variant="secondary" size="sm" onClick={() => copyUrl(f)} className="flex-1">
                    Copy URL
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => deleteFile(f)} className="text-red-600">
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview modal */}
      {preview && (
        <FilePreviewModal
          url={preview.url}
          fileName={preview.name}
          mimeType={preview.type}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
