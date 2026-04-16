'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TaskStatus = 'not_started' | 'in_progress' | 'testing' | 'complete';

interface Task {
  id: string;
  name: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignments?: Array<{
    user: { id: string; firstName: string; lastName: string } | null;
  }>;
}

type KanbanBoard = Record<TaskStatus, Task[]>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'not_started', label: 'Not Started' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'testing',     label: 'Testing' },
  { status: 'complete',    label: 'Completed' },
];

const STATUS_STYLES: Record<TaskStatus, { header: string; badge: string; dot: string }> = {
  not_started: { header: 'border-t-gray-400',   badge: 'bg-gray-50 text-gray-700',     dot: 'bg-gray-400' },
  in_progress: { header: 'border-t-blue-400',   badge: 'bg-blue-50 text-blue-700',     dot: 'bg-blue-400' },
  testing:     { header: 'border-t-yellow-400', badge: 'bg-yellow-50 text-yellow-700', dot: 'bg-yellow-400' },
  complete:    { header: 'border-t-green-400',  badge: 'bg-green-50 text-green-700',   dot: 'bg-green-400' },
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-600',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function initials(firstName: string, lastName: string): string {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase();
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
}

// ---------------------------------------------------------------------------
// Task card
// ---------------------------------------------------------------------------

function TaskCard({
  task,
  onDragStart,
}: {
  task: Task;
  onDragStart: (e: React.DragEvent, taskId: string, fromStatus: TaskStatus) => void;
}) {
  const assignee = task.assignments?.[0]?.user;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task.id, task.status as TaskStatus)}
      className="group bg-white border border-gray-100 rounded-lg p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md hover:border-gray-200 transition-all select-none"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <Link
          href={`/tasks/${task.id}`}
          className="text-sm font-medium text-gray-900 hover:text-primary leading-snug line-clamp-2"
          onClick={(e) => e.stopPropagation()}
        >
          {task.name}
        </Link>
      </div>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            PRIORITY_COLORS[task.priority] ?? 'bg-gray-100 text-gray-500'
          }`}
        >
          {task.priority}
        </span>
        {task.dueDate && (
          <span className="text-[10px] text-gray-400">{formatDate(task.dueDate)}</span>
        )}
      </div>

      <div className="flex items-center justify-between mt-2">
        <span />
        {assignee && (
          <div
            title={`${assignee.firstName} ${assignee.lastName}`}
            className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center"
          >
            {initials(assignee.firstName, assignee.lastName)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kanban column
// ---------------------------------------------------------------------------

function KanbanColumn({
  status,
  label,
  tasks,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent, taskId: string, fromStatus: TaskStatus) => void;
  onDragOver: (e: React.DragEvent, status: TaskStatus) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, toStatus: TaskStatus) => void;
}) {
  const style = STATUS_STYLES[status];

  return (
    <div className="flex flex-col min-w-[240px] w-[240px] flex-shrink-0">
      <div
        className={[
          'bg-white rounded-xl border border-gray-100 border-t-4 shadow-sm mb-2',
          style.header,
        ].join(' ')}
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm font-semibold text-gray-700">{label}</span>
          <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 font-medium">
            {tasks.length}
          </span>
        </div>
      </div>

      <div
        onDragOver={(e) => onDragOver(e, status)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDrop(e, status)}
        className={[
          'flex flex-col gap-2 flex-1 min-h-[120px] rounded-xl p-1.5 transition-colors',
          isDragOver ? 'bg-primary/5 ring-2 ring-primary/20' : 'bg-transparent',
        ].join(' ')}
      >
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onDragStart={onDragStart} />
        ))}

        {tasks.length === 0 && !isDragOver && (
          <div className="flex items-center justify-center h-20 text-xs text-gray-300 border-2 border-dashed border-gray-100 rounded-lg">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TasksKanbanPage() {
  const [board, setBoard] = useState<KanbanBoard>({
    not_started: [],
    in_progress: [],
    testing: [],
    complete: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const dragRef = useRef<{ taskId: string; fromStatus: TaskStatus } | null>(null);

  useEffect(() => {
    async function fetchTasks() {
      setLoading(true);
      setError(null);
      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/v1/tasks?limit=200`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        const json = await res.json();
        const tasks: Task[] = Array.isArray(json) ? json : json.data ?? [];

        const grouped: KanbanBoard = {
          not_started: [],
          in_progress: [],
          testing: [],
          complete: [],
        };
        for (const t of tasks) {
          const s = t.status as TaskStatus;
          if (grouped[s]) grouped[s].push(t);
          else grouped.not_started.push(t);
        }
        setBoard(grouped);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tasks');
      } finally {
        setLoading(false);
      }
    }
    fetchTasks();
  }, []);

  function handleDragStart(e: React.DragEvent, taskId: string, fromStatus: TaskStatus) {
    dragRef.current = { taskId, fromStatus };
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent, status: TaskStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStatus(status);
  }

  function handleDragLeave() {
    setDragOverStatus(null);
  }

  async function handleDrop(e: React.DragEvent, toStatus: TaskStatus) {
    e.preventDefault();
    setDragOverStatus(null);

    const drag = dragRef.current;
    if (!drag || drag.fromStatus === toStatus) return;

    const { taskId, fromStatus } = drag;
    dragRef.current = null;

    // Optimistic update
    setBoard((prev) => {
      const task = prev[fromStatus].find((t) => t.id === taskId);
      if (!task) return prev;
      return {
        ...prev,
        [fromStatus]: prev[fromStatus].filter((t) => t.id !== taskId),
        [toStatus]: [{ ...task, status: toStatus }, ...prev[toStatus]],
      };
    });

    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/v1/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: toStatus }),
      });

      if (!res.ok) {
        setBoard((prev) => {
          const task = prev[toStatus].find((t) => t.id === taskId);
          if (!task) return prev;
          return {
            ...prev,
            [toStatus]: prev[toStatus].filter((t) => t.id !== taskId),
            [fromStatus]: [{ ...task, status: fromStatus }, ...prev[fromStatus]],
          };
        });
      }
    } catch {
      setBoard((prev) => {
        const task = prev[toStatus].find((t) => t.id === taskId);
        if (!task) return prev;
        return {
          ...prev,
          [toStatus]: prev[toStatus].filter((t) => t.id !== taskId),
          [fromStatus]: [{ ...task, status: fromStatus }, ...prev[fromStatus]],
        };
      });
    }
  }

  const totalTasks = Object.values(board).reduce((acc, col) => acc + col.length, 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tasks - Kanban</h1>
          {!loading && (
            <p className="text-sm text-gray-500 mt-0.5">
              {totalTasks} task{totalTasks !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            List View
          </Link>
          <Link
            href="/tasks/new"
            className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            New Task
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600 flex-shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-x-auto pb-4">
        <div className="flex gap-3 h-full min-w-max">
          {loading
            ? COLUMNS.map((col) => (
                <div key={col.status} className="flex flex-col min-w-[240px] w-[240px] flex-shrink-0">
                  <div className="bg-white rounded-xl border border-gray-100 border-t-4 border-t-gray-200 shadow-sm mb-2 px-3 py-2.5 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-300">{col.label}</span>
                  </div>
                  <div className="flex flex-col gap-2 p-1.5">
                    {[1, 2].map((i) => (
                      <div key={i} className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm animate-pulse">
                        <div className="h-3.5 bg-gray-100 rounded w-3/4 mb-2" />
                        <div className="h-3 bg-gray-100 rounded w-1/2 mb-3" />
                        <div className="h-3 bg-gray-100 rounded w-1/4" />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            : COLUMNS.map((col) => (
                <KanbanColumn
                  key={col.status}
                  status={col.status}
                  label={col.label}
                  tasks={board[col.status]}
                  isDragOver={dragOverStatus === col.status}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                />
              ))}
        </div>
      </div>
    </div>
  );
}
