'use client';

import { useState, useEffect, useCallback } from 'react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form-field';

interface Todo {
  id: string;
  description: string;
  completed: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function TodosPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchTodos = useCallback(async () => {
    setLoading(true);
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/todos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const json = await res.json();
      setTodos(Array.isArray(json) ? json : json.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  async function add() {
    if (!input.trim()) return;
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/todos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content: input.trim() }),
    });
    setInput('');
    fetchTodos();
  }

  async function toggle(id: string) {
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/todos/${id}/toggle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchTodos();
  }

  async function remove(id: string) {
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/todos/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchTodos();
  }

  async function saveEdit(id: string) {
    if (!editValue.trim()) {
      setEditingId(null);
      return;
    }
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/todos/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content: editValue.trim() }),
    });
    setEditingId(null);
    fetchTodos();
  }

  return (
    <ListPageLayout title="My Todos" className="max-w-xl">
      <Card padding="md">
        <div className="flex gap-2 mb-4">
          <input
            aria-label="New todo"
            type="text"
            placeholder="Add a todo..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            className={`${inputClass} flex-1`}
          />
          <Button onClick={add}>Add</Button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">Loading...</p>
        ) : todos.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
            No todos yet — add one above.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {todos.map((todo) => (
              <li
                key={todo.id}
                className="flex items-center gap-3 py-2 group"
              >
                <input
                  aria-label={`Toggle ${todo.description}`}
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => toggle(todo.id)}
                  className="w-4 h-4"
                />
                {editingId === todo.id ? (
                  <input
                    aria-label="Edit todo"
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => saveEdit(todo.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit(todo.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="flex-1 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-sm"
                  />
                ) : (
                  <span
                    onDoubleClick={() => {
                      setEditingId(todo.id);
                      setEditValue(todo.description);
                    }}
                    className={[
                      'flex-1 text-sm cursor-text select-none',
                      todo.completed
                        ? 'line-through text-gray-400'
                        : 'text-gray-800',
                    ].join(' ')}
                  >
                    {todo.description}
                  </span>
                )}
                <button
                  onClick={() => remove(todo.id)}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </ListPageLayout>
  );
}
