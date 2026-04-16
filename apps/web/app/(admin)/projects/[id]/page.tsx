'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FilePreviewModal } from '../../../../components/file-preview-modal';

// ────────────────────────────────────────────────────────────────
//  Types
// ────────────────────────────────────────────────────────────────

interface Task {
  id: string;
  name: string;
  status: string;
  priority?: string;
  assignee?: { name?: string } | null;
  startDate?: string;
  dueDate?: string;
  milestoneId?: string | null;
}

interface Member {
  id: string;
  name?: string;
  email?: string;
  role?: string;
}

interface TimeEntry {
  id: string;
  description?: string;
  hours: number;
  date: string;
  user?: { name?: string } | null;
}

interface Milestone {
  id: string;
  name: string;
  description?: string | null;
  dueDate?: string | null;
  completed: boolean;
  color: string;
  order: number;
  tasks?: Task[];
}

interface ProjectFile {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
  mimeType?: string | null;
  userId?: string | null;
  createdAt: string;
}

interface DiscussionComment {
  id: string;
  content: string;
  userId?: string | null;
  createdAt: string;
}

interface Discussion {
  id: string;
  subject: string;
  description?: string | null;
  userId?: string | null;
  createdAt: string;
  _count?: { comments: number };
  comments?: DiscussionComment[];
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startDate?: string;
  deadline?: string;
  billingType?: string;
  estimatedHours?: number;
  client?: { id: string; company?: string; company_name?: string } | null;
  tasks?: Task[];
  members?: Member[];
  timeEntries?: TimeEntry[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

type Tab = 'overview' | 'tasks' | 'milestones' | 'files' | 'discussions' | 'gantt' | 'members' | 'time';

// ────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'complete':
    case 'finished':
      return 'bg-green-400';
    case 'in_progress':
      return 'bg-blue-400';
    case 'not_started':
      return 'bg-gray-300';
    case 'testing':
    case 'awaiting_feedback':
      return 'bg-yellow-400';
    default:
      return 'bg-gray-400';
  }
}

function ganttBarColor(status: string, dueDate?: string): string {
  if (status === 'complete') return 'bg-green-400';
  if (dueDate && new Date(dueDate) < new Date() && status !== 'complete') return 'bg-red-400';
  if (status === 'in_progress') return 'bg-blue-400';
  return 'bg-gray-300';
}

// ────────────────────────────────────────────────────────────────
//  Main Component
// ────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [p, setP] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [cloning, setCloning] = useState(false);

  // Milestones state
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [milestonesLoading, setMilestonesLoading] = useState(false);
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [msForm, setMsForm] = useState({ name: '', description: '', dueDate: '' });

  // Files state
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewFile, setPreviewFile] = useState<{ url: string; fileName: string; mimeType: string } | null>(null);

  // Discussions state
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [discussionsLoading, setDiscussionsLoading] = useState(false);
  const [showDiscussionForm, setShowDiscussionForm] = useState(false);
  const [discForm, setDiscForm] = useState({ subject: '', description: '' });
  const [expandedDiscussion, setExpandedDiscussion] = useState<string | null>(null);
  const [discussionComments, setDiscussionComments] = useState<Record<string, DiscussionComment[]>>({});
  const [replyText, setReplyText] = useState<Record<string, string>>({});

  // Gantt state
  const [ganttTasks, setGanttTasks] = useState<Task[]>([]);
  const [ganttLoading, setGanttLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/projects/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setP(json.data ?? json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (id) fetchData(); }, [id, fetchData]);

  // ─── Milestones fetching ─────────────────────────────────────

  const fetchMilestones = useCallback(async () => {
    setMilestonesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/projects/${id}/milestones`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setMilestones(Array.isArray(json) ? json : json.data ?? []);
      }
    } catch { /* silent */ }
    finally { setMilestonesLoading(false); }
  }, [id]);

  useEffect(() => { if (tab === 'milestones') fetchMilestones(); }, [tab, fetchMilestones]);

  async function handleCreateMilestone() {
    if (!msForm.name.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/projects/${id}/milestones`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(msForm),
      });
      if (res.ok) {
        setShowMilestoneForm(false);
        setMsForm({ name: '', description: '', dueDate: '' });
        fetchMilestones();
      }
    } catch { alert('Failed to create milestone'); }
  }

  async function handleUpdateMilestone() {
    if (!editingMilestone || !msForm.name.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/projects/${id}/milestones/${editingMilestone.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(msForm),
      });
      if (res.ok) {
        setEditingMilestone(null);
        setMsForm({ name: '', description: '', dueDate: '' });
        fetchMilestones();
      }
    } catch { alert('Failed to update milestone'); }
  }

  async function handleDeleteMilestone(milestoneId: string) {
    if (!confirm('Delete this milestone?')) return;
    try {
      await fetch(`${API_BASE}/api/v1/projects/${id}/milestones/${milestoneId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      fetchMilestones();
    } catch { alert('Failed to delete milestone'); }
  }

  async function handleToggleMilestone(ms: Milestone) {
    try {
      await fetch(`${API_BASE}/api/v1/projects/${id}/milestones/${ms.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ completed: !ms.completed }),
      });
      fetchMilestones();
    } catch { /* silent */ }
  }

  // ─── Files fetching ──────────────────────────────────────────

  const fetchFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/projects/${id}/files`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setFiles(Array.isArray(json) ? json : json.data ?? []);
      }
    } catch { /* silent */ }
    finally { setFilesLoading(false); }
  }, [id]);

  useEffect(() => { if (tab === 'files') fetchFiles(); }, [tab, fetchFiles]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', `projects/${id}`);

      const res = await fetch(`${API_BASE}/api/v1/storage/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const uploaded = await res.json();
      const data = uploaded.data ?? uploaded;

      // Register file record in project
      await fetch(`${API_BASE}/api/v1/projects/${id}/files`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          fileName: file.name,
          fileUrl: data.url ?? data.path ?? '',
          fileSize: file.size,
          mimeType: file.type || null,
        }),
      });
      fetchFiles();
    } catch { alert('File upload failed'); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDeleteFile(fileId: string) {
    if (!confirm('Delete this file?')) return;
    try {
      await fetch(`${API_BASE}/api/v1/projects/${id}/files/${fileId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      fetchFiles();
    } catch { alert('Failed to delete file'); }
  }

  async function handleDownloadFile(file: ProjectFile) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/storage/url?path=${encodeURIComponent(file.fileUrl)}`, {
        headers: authHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        const url = json.url ?? json.data?.url;
        if (url) window.open(url, '_blank');
      } else {
        // Fallback to direct URL
        window.open(file.fileUrl, '_blank');
      }
    } catch {
      window.open(file.fileUrl, '_blank');
    }
  }

  async function handlePreviewFile(file: ProjectFile) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/storage/url?path=${encodeURIComponent(file.fileUrl)}`, {
        headers: authHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        const url = json.url ?? json.data?.url ?? file.fileUrl;
        setPreviewFile({ url, fileName: file.fileName, mimeType: file.mimeType ?? 'application/octet-stream' });
      } else {
        setPreviewFile({ url: file.fileUrl, fileName: file.fileName, mimeType: file.mimeType ?? 'application/octet-stream' });
      }
    } catch {
      setPreviewFile({ url: file.fileUrl, fileName: file.fileName, mimeType: file.mimeType ?? 'application/octet-stream' });
    }
  }

  // ─── Discussions fetching ────────────────────────────────────

  const fetchDiscussions = useCallback(async () => {
    setDiscussionsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/projects/${id}/discussions`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setDiscussions(Array.isArray(json) ? json : json.data ?? []);
      }
    } catch { /* silent */ }
    finally { setDiscussionsLoading(false); }
  }, [id]);

  useEffect(() => { if (tab === 'discussions') fetchDiscussions(); }, [tab, fetchDiscussions]);

  async function handleCreateDiscussion() {
    if (!discForm.subject.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/projects/${id}/discussions`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(discForm),
      });
      if (res.ok) {
        setShowDiscussionForm(false);
        setDiscForm({ subject: '', description: '' });
        fetchDiscussions();
      }
    } catch { alert('Failed to create discussion'); }
  }

  async function handleExpandDiscussion(discussionId: string) {
    if (expandedDiscussion === discussionId) {
      setExpandedDiscussion(null);
      return;
    }
    setExpandedDiscussion(discussionId);
    try {
      const res = await fetch(`${API_BASE}/api/v1/projects/${id}/discussions/${discussionId}`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        const disc = json.data ?? json;
        setDiscussionComments((prev) => ({ ...prev, [discussionId]: disc.comments ?? [] }));
      }
    } catch { /* silent */ }
  }

  async function handleAddComment(discussionId: string) {
    const text = replyText[discussionId]?.trim();
    if (!text) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/projects/${id}/discussions/${discussionId}/comments`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        setReplyText((prev) => ({ ...prev, [discussionId]: '' }));
        // Refresh comments
        handleExpandDiscussion(discussionId);
        // Also refresh list for updated count
        fetchDiscussions();
      }
    } catch { alert('Failed to add comment'); }
  }

  // ─── Gantt data ──────────────────────────────────────────────

  const fetchGanttTasks = useCallback(async () => {
    setGanttLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/tasks?projectId=${id}&limit=200`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        const data = json.data ?? json;
        setGanttTasks(Array.isArray(data) ? data : []);
      }
    } catch { /* silent */ }
    finally { setGanttLoading(false); }
  }, [id]);

  useEffect(() => { if (tab === 'gantt') fetchGanttTasks(); }, [tab, fetchGanttTasks]);

  // ─── Clone ───────────────────────────────────────────────────

  async function handleClone() {
    setCloning(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/projects/${id}/clone`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Clone failed (${res.status})`);
      const cloned = await res.json();
      const clonedId = cloned?.data?.id ?? cloned?.id;
      if (clonedId) {
        router.push(`/projects/${clonedId}`);
      } else {
        router.push('/projects');
      }
    } catch {
      alert('Failed to clone project');
    } finally {
      setCloning(false);
    }
  }

  if (loading) return <div className="max-w-4xl animate-pulse h-96 bg-gray-100 rounded-xl" />;
  if (error || !p) return <div className="text-red-600">{error ?? 'Not found'}</div>;

  const allTabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'milestones', label: 'Milestones' },
    { key: 'files', label: 'Files' },
    { key: 'discussions', label: 'Discussions' },
    { key: 'gantt', label: 'Gantt' },
    { key: 'members', label: 'Members' },
    { key: 'time', label: 'Time Entries' },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-4"><Link href="/projects" className="text-sm text-gray-500 hover:text-primary">← Back to projects</Link></div>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{p.name}</h1>
          <p className="text-sm text-gray-500 mt-1">{p.client?.company ?? p.client?.company_name ?? '—'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClone}
            disabled={cloning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
            </svg>
            {cloning ? 'Cloning...' : 'Clone Project'}
          </button>
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">{p.status}</span>
        </div>
      </div>

      {/* ─── Tab Navigation ─────────────────────────────────────── */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6 overflow-x-auto">
          {allTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.key ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ─── Overview ───────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <Detail label="Start Date">{p.startDate ? new Date(p.startDate).toLocaleDateString() : '—'}</Detail>
            <Detail label="Deadline">{p.deadline ? new Date(p.deadline).toLocaleDateString() : '—'}</Detail>
            <Detail label="Billing Type">{p.billingType ?? '—'}</Detail>
            <Detail label="Estimated Hours">{p.estimatedHours ?? '—'}</Detail>
            <Detail label="Description" wide>{p.description ?? '—'}</Detail>
          </dl>
        </div>
      )}

      {/* ─── Tasks ──────────────────────────────────────────────── */}
      {tab === 'tasks' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {(p.tasks ?? []).length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No tasks yet</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Task</th>
                  <th className="px-4 py-3">Assignee</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {(p.tasks ?? []).map((t) => (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className="px-4 py-3 text-gray-900">{t.name}</td>
                    <td className="px-4 py-3 text-gray-600">{t.assignee?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ─── Milestones ─────────────────────────────────────────── */}
      {tab === 'milestones' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Milestones</h2>
            <button
              onClick={() => {
                setEditingMilestone(null);
                setMsForm({ name: '', description: '', dueDate: '' });
                setShowMilestoneForm(true);
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90"
            >
              + Add Milestone
            </button>
          </div>

          {/* Inline form */}
          {(showMilestoneForm || editingMilestone) && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  placeholder="Milestone name"
                  value={msForm.name}
                  onChange={(e) => setMsForm({ ...msForm, name: e.target.value })}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <input
                  type="date"
                  value={msForm.dueDate}
                  onChange={(e) => setMsForm({ ...msForm, dueDate: e.target.value })}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <input
                  placeholder="Description (optional)"
                  value={msForm.description}
                  onChange={(e) => setMsForm({ ...msForm, description: e.target.value })}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={editingMilestone ? handleUpdateMilestone : handleCreateMilestone}
                  className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90"
                >
                  {editingMilestone ? 'Update' : 'Create'}
                </button>
                <button
                  onClick={() => { setShowMilestoneForm(false); setEditingMilestone(null); }}
                  className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {milestonesLoading ? (
            <div className="animate-pulse h-32 bg-gray-100 rounded-xl" />
          ) : milestones.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-12 text-center text-sm text-gray-400">No milestones yet</div>
          ) : (
            <div className="space-y-3">
              {milestones.map((ms) => {
                const totalTasks = ms.tasks?.length ?? 0;
                const doneTasks = ms.tasks?.filter((t) => t.status === 'complete').length ?? 0;
                const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

                return (
                  <div key={ms.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1">
                        <button
                          onClick={() => handleToggleMilestone(ms)}
                          className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                            ms.completed ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          {ms.completed && (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: ms.color }}
                            />
                            <h3 className={`text-sm font-semibold ${ms.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{ms.name}</h3>
                          </div>
                          {ms.description && <p className="text-xs text-gray-500 mt-0.5 ml-4">{ms.description}</p>}
                          {ms.dueDate && (
                            <p className="text-xs text-gray-400 mt-0.5 ml-4">
                              Due: {new Date(ms.dueDate).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingMilestone(ms);
                            setShowMilestoneForm(false);
                            setMsForm({
                              name: ms.name,
                              description: ms.description ?? '',
                              dueDate: ms.dueDate ? ms.dueDate.substring(0, 10) : '',
                            });
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600"
                          title="Edit"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteMilestone(ms.id)}
                          className="p-1 text-gray-400 hover:text-red-500"
                          title="Delete"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="mt-3 ml-8">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>{doneTasks}/{totalTasks} tasks</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>

                    {/* Tasks under this milestone */}
                    {totalTasks > 0 && (
                      <div className="mt-3 ml-8 space-y-1">
                        {ms.tasks!.map((t) => (
                          <div key={t.id} className="flex items-center gap-2 text-xs text-gray-600">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor(t.status)}`} />
                            <span className={t.status === 'complete' ? 'line-through text-gray-400' : ''}>{t.name}</span>
                            {t.dueDate && (
                              <span className="text-gray-400 ml-auto">{new Date(t.dueDate).toLocaleDateString()}</span>
                            )}
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
      )}

      {/* ─── Files ──────────────────────────────────────────────── */}
      {tab === 'files' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Files</h2>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                {uploading ? 'Uploading...' : 'Upload File'}
              </button>
            </div>
          </div>

          {filesLoading ? (
            <div className="animate-pulse h-32 bg-gray-100 rounded-xl" />
          ) : files.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-12 text-center text-sm text-gray-400">No files uploaded yet</div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Size</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.id} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-gray-900 font-medium">
                        <button
                          onClick={() => handlePreviewFile(f)}
                          className="text-left hover:text-primary transition-colors"
                        >
                          {f.fileName}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatBytes(f.fileSize)}</td>
                      <td className="px-4 py-3 text-gray-600">{new Date(f.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handlePreviewFile(f)}
                            className="p-1 text-gray-400 hover:text-primary"
                            title="Preview"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDownloadFile(f)}
                            className="p-1 text-gray-400 hover:text-primary"
                            title="Download"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteFile(f.id)}
                            className="p-1 text-gray-400 hover:text-red-500"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Discussions ────────────────────────────────────────── */}
      {tab === 'discussions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Discussions</h2>
            <button
              onClick={() => { setShowDiscussionForm(true); setDiscForm({ subject: '', description: '' }); }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90"
            >
              + New Discussion
            </button>
          </div>

          {showDiscussionForm && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
              <input
                placeholder="Subject"
                value={discForm.subject}
                onChange={(e) => setDiscForm({ ...discForm, subject: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <textarea
                placeholder="Body (optional)"
                value={discForm.description}
                onChange={(e) => setDiscForm({ ...discForm, description: e.target.value })}
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
              <div className="flex gap-2">
                <button onClick={handleCreateDiscussion} className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90">
                  Create
                </button>
                <button onClick={() => setShowDiscussionForm(false)} className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {discussionsLoading ? (
            <div className="animate-pulse h-32 bg-gray-100 rounded-xl" />
          ) : discussions.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-12 text-center text-sm text-gray-400">No discussions yet</div>
          ) : (
            <div className="space-y-2">
              {discussions.map((d) => (
                <div key={d.id} className="bg-white rounded-xl border border-gray-100 shadow-sm">
                  <button
                    onClick={() => handleExpandDiscussion(d.id)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors rounded-xl"
                  >
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{d.subject}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(d.createdAt).toLocaleDateString()} · {d._count?.comments ?? 0} replies
                      </p>
                    </div>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${expandedDiscussion === d.id ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>

                  {expandedDiscussion === d.id && (
                    <div className="border-t border-gray-100 px-4 py-3 space-y-3">
                      {d.description && (
                        <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{d.description}</p>
                      )}

                      {/* Comments */}
                      <div className="space-y-2">
                        {(discussionComments[d.id] ?? []).map((c) => (
                          <div key={c.id} className="pl-4 border-l-2 border-gray-200">
                            <p className="text-sm text-gray-700">{c.content}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{new Date(c.createdAt).toLocaleDateString()}</p>
                          </div>
                        ))}
                      </div>

                      {/* Reply form */}
                      <div className="flex gap-2">
                        <input
                          placeholder="Write a reply..."
                          value={replyText[d.id] ?? ''}
                          onChange={(e) => setReplyText((prev) => ({ ...prev, [d.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(d.id); }}
                          className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <button
                          onClick={() => handleAddComment(d.id)}
                          className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90"
                        >
                          Reply
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Gantt Chart ────────────────────────────────────────── */}
      {tab === 'gantt' && (
        <GanttChart project={p} tasks={ganttTasks} loading={ganttLoading} />
      )}

      {/* ─── Members ────────────────────────────────────────────── */}
      {tab === 'members' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          {(p.members ?? []).length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-8">No members</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {(p.members ?? []).map((m) => (
                <li key={m.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{m.name ?? m.email}</p>
                    <p className="text-xs text-gray-500">{m.email}</p>
                  </div>
                  <span className="text-xs text-gray-500">{m.role ?? 'member'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ─── File Preview Modal ──────────────────────────────────── */}
      {previewFile && (
        <FilePreviewModal
          url={previewFile.url}
          fileName={previewFile.fileName}
          mimeType={previewFile.mimeType}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {/* ─── Time Entries ───────────────────────────────────────── */}
      {tab === 'time' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {(p.timeEntries ?? []).length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No time entries yet</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Hours</th>
                </tr>
              </thead>
              <tbody>
                {(p.timeEntries ?? []).map((t) => (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className="px-4 py-3">{new Date(t.date).toLocaleDateString()}</td>
                    <td className="px-4 py-3">{t.user?.name ?? '—'}</td>
                    <td className="px-4 py-3">{t.description ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{t.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  Gantt Chart Component (CSS-only, no libraries)
// ────────────────────────────────────────────────────────────────

function GanttChart({ project, tasks, loading }: { project: Project; tasks: Task[]; loading: boolean }) {
  if (loading) return <div className="animate-pulse h-64 bg-gray-100 rounded-xl" />;

  if (!project.startDate || !project.deadline) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-12 text-center text-sm text-gray-400">
        Set project start date and deadline to view Gantt chart
      </div>
    );
  }

  const projectStart = new Date(project.startDate);
  const projectEnd = new Date(project.deadline);
  const totalDays = Math.max(1, (projectEnd.getTime() - projectStart.getTime()) / (1000 * 60 * 60 * 24));

  function getPercent(date: Date): number {
    const days = (date.getTime() - projectStart.getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0, Math.min(100, (days / totalDays) * 100));
  }

  // Generate week labels
  const weeks: { label: string; left: number }[] = [];
  const cursor = new Date(projectStart);
  // Align to Monday
  cursor.setDate(cursor.getDate() - cursor.getDay() + 1);
  while (cursor <= projectEnd) {
    const pct = getPercent(new Date(cursor));
    if (pct >= 0 && pct <= 100) {
      weeks.push({
        label: cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        left: pct,
      });
    }
    cursor.setDate(cursor.getDate() + 7);
  }

  const todayPct = getPercent(new Date());

  // Filter tasks that have dates
  const ganttTasks = tasks.filter((t) => t.startDate || t.dueDate);

  if (ganttTasks.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-12 text-center text-sm text-gray-400">
        No tasks with dates to display on Gantt chart
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[800px]">
          {/* Header with week labels */}
          <div className="relative h-8 bg-gray-50 border-b border-gray-200">
            {weeks.map((w, i) => (
              <div
                key={i}
                className="absolute top-0 h-full border-l border-gray-200 flex items-center"
                style={{ left: `${Math.max(0, w.left)}%` }}
              >
                <span className="text-[10px] text-gray-400 pl-1 whitespace-nowrap">{w.label}</span>
              </div>
            ))}
          </div>

          {/* Task rows */}
          <div className="relative">
            {/* Vertical week lines */}
            {weeks.map((w, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 border-l border-gray-100"
                style={{ left: `${Math.max(0, w.left)}%` }}
              />
            ))}

            {/* Today line */}
            {todayPct >= 0 && todayPct <= 100 && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10"
                style={{ left: `${todayPct}%` }}
                title="Today"
              />
            )}

            {ganttTasks.map((task) => {
              const tStart = task.startDate ? new Date(task.startDate) : task.dueDate ? new Date(task.dueDate) : projectStart;
              const tEnd = task.dueDate ? new Date(task.dueDate) : task.startDate ? new Date(task.startDate) : projectEnd;
              const left = getPercent(tStart);
              const right = getPercent(tEnd);
              const width = Math.max(1, right - left);

              return (
                <div key={task.id} className="flex items-center h-9 border-b border-gray-50 relative">
                  {/* Task name */}
                  <div className="w-48 flex-shrink-0 px-3 text-xs text-gray-700 truncate border-r border-gray-100 bg-white z-20 relative">
                    {task.name}
                  </div>
                  {/* Bar area */}
                  <div className="flex-1 relative h-full">
                    <div
                      className={`absolute top-1.5 h-6 rounded ${ganttBarColor(task.status, task.dueDate)} opacity-80`}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        minWidth: '4px',
                      }}
                      title={`${task.name} (${task.status})`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 bg-gray-50">
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="w-3 h-2 rounded bg-gray-300" /> Not started
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="w-3 h-2 rounded bg-blue-400" /> In progress
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="w-3 h-2 rounded bg-green-400" /> Completed
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="w-3 h-2 rounded bg-red-400" /> Overdue
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="w-3 h-0.5 bg-red-400" /> Today
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  Detail helper
// ────────────────────────────────────────────────────────────────

function Detail({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs text-gray-500 mb-1">{label}</dt>
      <dd className="text-gray-900">{children}</dd>
    </div>
  );
}
