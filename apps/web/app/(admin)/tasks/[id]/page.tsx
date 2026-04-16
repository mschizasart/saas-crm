'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

interface ChecklistItem {
  id: string;
  description: string;
  completed: boolean;
}

interface Comment {
  id: string;
  content: string;
  createdAt: string;
}

interface TaskSummary {
  id: string;
  name: string;
  status: string;
  priority?: string;
}

interface Dependency {
  id: string;
  dependsOnId: string;
  dependsOn: TaskSummary;
}

interface Task {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  projectId?: string | null;
  project?: { id: string; name: string } | null;
  assignments?: Array<{
    user: { id: string; firstName: string; lastName: string } | null;
  }>;
  checklists?: ChecklistItem[];
  comments?: Comment[];
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [newChecklist, setNewChecklist] = useState('');
  const [newComment, setNewComment] = useState('');
  const [assignUserId, setAssignUserId] = useState('');
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [availableTasks, setAvailableTasks] = useState<TaskSummary[]>([]);
  const [selectedDepId, setSelectedDepId] = useState('');
  const [blockedBy, setBlockedBy] = useState<TaskSummary[]>([]);

  const fetchTask = useCallback(async () => {
    setLoading(true);
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/tasks/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setTask(await res.json());
    setLoading(false);
  }, [id]);

  const fetchDependencies = useCallback(async () => {
    const token = getToken();
    try {
      const [depsRes, canStartRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/tasks/${id}/dependencies`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/api/v1/tasks/${id}/can-start`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (depsRes.ok) {
        const data = await depsRes.json();
        setDependencies(Array.isArray(data) ? data : data.data ?? []);
      }
      if (canStartRes.ok) {
        const data = await canStartRes.json();
        setBlockedBy(data.blockedBy ?? []);
      }
    } catch { /* ignore */ }
  }, [id]);

  const fetchAvailableTasks = useCallback(async () => {
    const token = getToken();
    try {
      const res = await fetch(`${API_BASE}/api/v1/tasks?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const tasks = (data.data ?? []).filter((t: any) => t.id !== id);
        setAvailableTasks(tasks);
      }
    } catch { /* ignore */ }
  }, [id]);

  useEffect(() => {
    fetchTask();
    fetchDependencies();
    fetchAvailableTasks();
  }, [fetchTask, fetchDependencies, fetchAvailableTasks]);

  async function updateStatus(status: string) {
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/tasks/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    });
    fetchTask();
  }

  async function addChecklist() {
    if (!newChecklist.trim()) return;
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/tasks/${id}/checklist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: newChecklist }),
    });
    setNewChecklist('');
    fetchTask();
  }

  async function toggleChecklist(itemId: string) {
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/tasks/checklist/${itemId}/toggle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchTask();
  }

  async function addComment() {
    if (!newComment.trim()) return;
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/tasks/${id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content: newComment }),
    });
    setNewComment('');
    fetchTask();
  }

  async function assign() {
    if (!assignUserId.trim()) return;
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/tasks/${id}/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: assignUserId }),
    });
    setAssignUserId('');
    fetchTask();
  }

  async function addDependency() {
    if (!selectedDepId) return;
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/tasks/${id}/dependencies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dependsOnId: selectedDepId }),
    });
    setSelectedDepId('');
    fetchDependencies();
  }

  async function removeDependency(dependsOnId: string) {
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/tasks/${id}/dependencies/${dependsOnId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchDependencies();
  }

  async function remove() {
    if (!confirm('Delete this task?')) return;
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/tasks/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    router.push('/tasks');
  }

  if (loading) return <div className="text-gray-400">Loading...</div>;
  if (!task) return <div className="text-gray-400">Task not found</div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{task.name}</h1>
          {task.project && (
            <p className="text-sm text-gray-500 mt-1">
              Project: {task.project.name}
            </p>
          )}
        </div>
        <button
          onClick={remove}
          className="text-sm text-red-600 hover:text-red-700"
        >
          Delete
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        {task.description && (
          <p className="text-sm text-gray-700 whitespace-pre-line">
            {task.description}
          </p>
        )}
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700">Status</label>
          <select
            value={task.status}
            onChange={(e) => updateStatus(e.target.value)}
            className="border border-gray-200 rounded-md px-3 py-1.5 text-sm bg-white"
          >
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="testing">Testing</option>
            <option value="awaiting_feedback">Awaiting feedback</option>
            <option value="complete">Complete</option>
          </select>
          <span className="text-sm text-gray-500">
            Priority: <span className="capitalize">{task.priority}</span>
          </span>
          {task.dueDate && (
            <span className="text-sm text-gray-500">
              Due: {new Date(task.dueDate).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Assignees</h2>
        <div className="text-sm text-gray-700 mb-3">
          {task.assignments?.length
            ? task.assignments
                .map((a) =>
                  a.user ? `${a.user.firstName} ${a.user.lastName}` : '',
                )
                .filter(Boolean)
                .join(', ')
            : 'No assignees'}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="User ID to assign"
            value={assignUserId}
            onChange={(e) => setAssignUserId(e.target.value)}
            className="flex-1 border border-gray-200 rounded-md px-3 py-1.5 text-sm"
          />
          <button
            onClick={assign}
            className="px-3 py-1.5 text-sm bg-primary text-white rounded-md hover:bg-primary/90"
          >
            Assign
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Checklist</h2>
        <div className="space-y-2 mb-3">
          {task.checklists?.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <input
                type="checkbox"
                checked={c.completed}
                onChange={() => toggleChecklist(c.id)}
              />
              <span
                className={
                  c.completed ? 'line-through text-gray-400' : 'text-gray-700'
                }
              >
                {c.description}
              </span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Add checklist item..."
            value={newChecklist}
            onChange={(e) => setNewChecklist(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addChecklist()}
            className="flex-1 border border-gray-200 rounded-md px-3 py-1.5 text-sm"
          />
          <button
            onClick={addChecklist}
            className="px-3 py-1.5 text-sm bg-primary text-white rounded-md hover:bg-primary/90"
          >
            Add
          </button>
        </div>
      </div>

      {/* Dependencies */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Dependencies</h2>

        {blockedBy.length > 0 && (
          <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800 font-medium">
              Blocked by:{' '}
              {blockedBy.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && ', '}
                  {b.name}
                  <span className="text-amber-600 text-xs ml-1">({b.status})</span>
                </span>
              ))}
            </p>
          </div>
        )}

        <div className="space-y-2 mb-3">
          {dependencies.length === 0 && (
            <p className="text-sm text-gray-400">No dependencies</p>
          )}
          {dependencies.map((dep) => (
            <div
              key={dep.id}
              className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-gray-900">{dep.dependsOn.name}</span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    dep.dependsOn.status === 'complete'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {dep.dependsOn.status}
                </span>
              </div>
              <button
                onClick={() => removeDependency(dep.dependsOn.id)}
                className="text-gray-400 hover:text-red-500 text-sm px-1"
                title="Remove dependency"
              >
                x
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <select
            value={selectedDepId}
            onChange={(e) => setSelectedDepId(e.target.value)}
            className="flex-1 border border-gray-200 rounded-md px-3 py-1.5 text-sm bg-white"
          >
            <option value="">-- Add dependency --</option>
            {availableTasks
              .filter(
                (t) => !dependencies.some((d) => d.dependsOn.id === t.id),
              )
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.status})
                </option>
              ))}
          </select>
          <button
            onClick={addDependency}
            disabled={!selectedDepId}
            className="px-3 py-1.5 text-sm bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Comments</h2>
        <div className="space-y-3 mb-3">
          {task.comments?.map((c) => (
            <div
              key={c.id}
              className="text-sm border-l-2 border-gray-200 pl-3 py-1"
            >
              <p className="text-gray-700 whitespace-pre-line">{c.content}</p>
              <p className="text-xs text-gray-400 mt-1">
                {new Date(c.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
          {!task.comments?.length && (
            <p className="text-sm text-gray-400">No comments</p>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Write a comment..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addComment()}
            className="flex-1 border border-gray-200 rounded-md px-3 py-1.5 text-sm"
          />
          <button
            onClick={addComment}
            className="px-3 py-1.5 text-sm bg-primary text-white rounded-md hover:bg-primary/90"
          >
            Post
          </button>
        </div>
      </div>
    </div>
  );
}
