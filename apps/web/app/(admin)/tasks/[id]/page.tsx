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

interface Task {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
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

  const fetchTask = useCallback(async () => {
    setLoading(true);
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/tasks/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setTask(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

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
