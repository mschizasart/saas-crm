'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

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
    if (f.type === 'application/pdf') {
      window.open(f.url, '_blank');
      return;
    }
    setPreview(f);
  };

  const breadcrumbs = folder ? folder.split('/') : [];
  const filtered = files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Media Manager</h1>
        <div className="flex gap-2">
          <button
            onClick={createFolder}
            className="px-4 py-2 border rounded hover:bg-gray-50"
          >
            New Folder
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFileInputChange}
          />
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 mb-4 text-sm">
        <button
          onClick={() => setFolder('')}
          className="text-blue-600 hover:underline"
        >
          root
        </button>
        {breadcrumbs.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-gray-400">/</span>
            <button
              onClick={() =>
                setFolder(breadcrumbs.slice(0, i + 1).join('/'))
              }
              className="text-blue-600 hover:underline"
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search files..."
        className="w-full max-w-sm px-3 py-2 border rounded mb-4"
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
          dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
        }`}
      >
        {loading ? (
          <div className="text-center text-gray-500 py-12">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            No files. Drop files here or click Upload.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {filtered.map((f) => (
              <div
                key={f.path}
                className="border rounded-lg p-3 bg-white hover:shadow-md transition"
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
                  <div className="text-xs text-gray-500">
                    {formatSize(f.size)}
                  </div>
                  {f.lastModified && (
                    <div className="text-xs text-gray-400">
                      {new Date(f.lastModified).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 mt-2">
                  <button
                    onClick={() => copyUrl(f)}
                    className="flex-1 text-xs px-2 py-1 border rounded hover:bg-gray-50"
                  >
                    Copy URL
                  </button>
                  <button
                    onClick={() => deleteFile(f)}
                    className="text-xs px-2 py-1 border rounded text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview modal */}
      {preview && (
        <div
          onClick={() => setPreview(null)}
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-auto p-4"
          >
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold">{preview.name}</h3>
              <button
                onClick={() => setPreview(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            {preview.type.startsWith('image/') ? (
              <img
                src={preview.url}
                alt={preview.name}
                className="max-w-full max-h-[70vh] mx-auto"
              />
            ) : (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">{fileIcon(preview.type)}</div>
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Open in new tab
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
